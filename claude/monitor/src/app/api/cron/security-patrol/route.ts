/**
 * 警備 自動巡回スケジューラ cron（Phase A / A1）。
 *
 * Vercel Cron が10分毎に実行（vercel.json）。security_settings の店舗別
 * スケジュール（interval / fixed・業務時間帯・曜日）で「期限到来」の店舗を判定し、
 *   1. patrol_runs を1件起票（trigger='scheduled'・冪等）
 *   2. その店舗のエッジ（edge_devices）の pending_command に capture_snapshot を書込む
 *      （エッジが 500ms ポーリングで拾い、全カメラを撮影して ingest へ POST する）
 *   3. security_settings.last_run_at を更新
 * を行う。判定・比較・AI は挟まない（撮影と記録のみ＝証跡型巡回）。
 *
 * 保持 30 日: 起点 30 日より古い patrol_runs / patrol_findings / スナップショットを
 * purge する（毎時1回だけ実行。security_reports は証跡として残す）。
 *
 * 認証: edge-health cron と同じ CRON_SECRET（Bearer or x-cron-secret）。未設定なら 503。
 *
 * 単一スロット transport の配慮:
 *   pending_command は edge_devices の1スロット JSONB。ライブ/VOD コマンドを踏み潰さない
 *   よう、pending_command が空 かつ エッジが応答中（last_seen_at が新しい）ときだけ発行する。
 *   踏めなかった店舗は次の cron tick で再評価される（4時間巡回なので取りこぼしは軽微）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import type { EdgeCommand } from '@/lib/edge/commands'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'
import { jstNow, isDue, type PatrolSettings } from '@/lib/security/patrol-schedule'

export const runtime = 'nodejs'

const PURGE_DAYS = 30
const PURGE_RUN_LIMIT = 500 // 1 tick あたりの purge 上限（タイムアウト回避）

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 認証（edge-health と同一慣例）
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const jst = jstNow(now)
  const cronWindowMin = Number(process.env.SECURITY_PATROL_CRON_MIN ?? 10)
  const staleMs = Number(process.env.EDGE_STALE_SECONDS ?? MONITOR_STALE_SECONDS) * 1000
  const monitorUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://intereco-monitor.vercel.app'
  const ingestUrl = `${monitorUrl}/api/security/patrol/ingest`

  const supa = createSupabaseService()

  const { data: settings, error } = await supa
    .from('security_settings')
    .select('store_id, enabled, schedule_mode, patrol_interval_min, active_from, active_to, active_days, patrol_times, last_run_at')
    .eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const due = (settings ?? []).filter((s) => isDue(s as PatrolSettings, jst, now, cronWindowMin))

  let dispatched = 0, skippedBusy = 0, skippedOffline = 0, skippedNoCam = 0
  const details: Array<{ store_id: string; result: string }> = []

  for (const s of due as PatrolSettings[]) {
    const storeId = s.store_id as string

    // エッジ（1店舗=1エッジ）を取得。単一スロットを踏まないよう空きと応答を確認。
    const { data: edge } = await supa
      .from('edge_devices')
      .select('id, pending_command, last_seen_at')
      .eq('store_id', storeId)
      .maybeSingle()

    if (!edge) { skippedOffline++; details.push({ store_id: storeId, result: 'no_edge' }); continue }
    const fresh = edge.last_seen_at && (now.getTime() - new Date(edge.last_seen_at).getTime()) < staleMs
    if (!fresh) { skippedOffline++; details.push({ store_id: storeId, result: 'edge_offline' }); continue }
    if (edge.pending_command != null) { skippedBusy++; details.push({ store_id: storeId, result: 'edge_busy' }); continue }

    // 巡回対象カメラ = 店舗のカメラのうち、config で patrol_enabled=false のものを除く。
    const { data: cams } = await supa
      .from('recorder_cameras')
      .select('id')
      .eq('store_id', storeId)
    const camIds = (cams ?? []).map((c) => c.id as string)
    if (!camIds.length) { skippedNoCam++; details.push({ store_id: storeId, result: 'no_camera' }); continue }

    const { data: cfgs } = await supa
      .from('security_camera_config')
      .select('camera_id, patrol_enabled')
      .in('camera_id', camIds)
    const disabled = new Set((cfgs ?? []).filter((c) => c.patrol_enabled === false).map((c) => c.camera_id as string))
    const patrolCams = camIds.filter((id) => !disabled.has(id))
    if (!patrolCams.length) { skippedNoCam++; details.push({ store_id: storeId, result: 'all_cams_disabled' }); continue }

    // patrol_runs 起票（冪等: 同一 store×scheduled_for は unique index で1件）。
    const scheduledFor = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString()
    const { data: run, error: runErr } = await supa
      .from('patrol_runs')
      .insert({ store_id: storeId, trigger: 'scheduled', scheduled_for: scheduledFor, status: 'capturing' })
      .select('id')
      .maybeSingle()
    if (runErr || !run) {
      // unique 衝突（同分の二重tick）等 → スキップ。
      details.push({ store_id: storeId, result: 'run_exists_or_error' })
      continue
    }

    // capture_snapshot を pending_command に書込む。
    const command: EdgeCommand = {
      action: 'capture_snapshot',
      request_id: randomUUID(),
      run_id: run.id as string,
      camera_ids: patrolCams,
      ingest_url: ingestUrl,
    }
    await supa
      .from('edge_devices')
      .update({ pending_command: command, pending_command_at: now.toISOString() })
      .eq('id', edge.id)
    await supa
      .from('security_settings')
      .update({ last_run_at: now.toISOString() })
      .eq('store_id', storeId)

    dispatched++
    details.push({ store_id: storeId, result: 'dispatched' })
  }

  // ── 保持 30 日 purge（毎時1回だけ＝10分cronの無駄打ち回避）
  let purged: { runs: number } | null = null
  if (now.getUTCMinutes() < cronWindowMin) {
    purged = await purgeOld(supa, now)
  }

  return NextResponse.json({
    ok: true,
    jst,
    dueCount: due.length,
    dispatched,
    skippedBusy,
    skippedOffline,
    skippedNoCam,
    purged,
    details,
  })
}

/** 30日より古い巡回とスナップショットを削除。security_reports は残す。 */
async function purgeOld(
  supa: ReturnType<typeof createSupabaseService>,
  now: Date,
): Promise<{ runs: number }> {
  const cutoff = new Date(now.getTime() - PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: oldRuns } = await supa
    .from('patrol_runs')
    .select('id')
    .lt('started_at', cutoff)
    .limit(PURGE_RUN_LIMIT)
  const runIds = (oldRuns ?? []).map((r) => r.id as string)
  if (!runIds.length) return { runs: 0 }

  // スナップショット削除（run プレフィックス配下を list → remove）。
  for (const runId of runIds) {
    const { data: objs } = await supa.storage.from('security-snapshots').list(runId)
    const paths = (objs ?? []).map((o) => `${runId}/${o.name}`)
    if (paths.length) await supa.storage.from('security-snapshots').remove(paths)
  }

  await supa.from('patrol_findings').delete().in('run_id', runIds)
  await supa.from('patrol_runs').delete().in('id', runIds)
  return { runs: runIds.length }
}
