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
 * 保持 31 日: 起点 31 日より古い patrol_runs / patrol_findings / スナップショットを
 * purge する（毎時1回だけ実行。security_reports は証跡として残す）。データガバナンス方針=保持31日。
 *
 * 認証: edge-health cron と同じ CRON_SECRET（Bearer or x-cron-secret）。未設定なら 503。
 *
 * 単一スロット transport の配慮:
 *   pending_command は edge_devices の1スロット JSONB。ライブ/VOD コマンドを踏み潰さない
 *   よう、pending_command が空 かつ エッジが応答中（last_seen_at が新しい）ときだけ発行する。
 *   踏めなかった店舗は次の cron tick で再評価される（4時間巡回なので取りこぼしは軽微）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'
import { jstNow, isDue, type PatrolSettings } from '@/lib/security/patrol-schedule'
import { listPatrolCameraIds, buildCaptureCommand } from '@/lib/security/patrol-dispatch'
import { generateAndStoreRunReport } from '@/lib/security/patrol-report'

export const runtime = 'nodejs'
export const maxDuration = 120

const PURGE_DAYS = 31   // データガバナンス方針: 保持31日（docs/data-governance-sla.md）
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

    // 巡回対象カメラ = エッジ配下カメラのうち、config で patrol_enabled=false のものを除く。
    const patrolCams = await listPatrolCameraIds(supa, edge.id)
    if (!patrolCams.length) { skippedNoCam++; details.push({ store_id: storeId, result: 'no_camera' }); continue }

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
    const command = buildCaptureCommand(run.id as string, patrolCams)
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

  // ── 手動巡回(今すぐ巡回)の自動レポート化 → /security/reports に載せる。
  //    撮影が settle するよう 2分以上経過・findings 有り・未生成 のものだけ対象。
  //    定時巡回は日次ロールアップ(security-report cron)に任せるため対象外。
  const finalizedReports = await finalizeManualReports(supa, now)

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
    finalizedReports,
    purged,
    details,
  })
}

/**
 * 手動巡回(trigger='manual')で撮影が終わった run を自動レポート化する。
 * 2分以上前〜1日以内・findings 有り・security_reports 未生成 のものだけを対象に、
 * PDF生成＋security_reports 行 upsert（generateAndStoreRunReport が冪等）。
 */
async function finalizeManualReports(
  supa: ReturnType<typeof createSupabaseService>,
  now: Date,
): Promise<number> {
  const settleBefore = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data: runs } = await supa
    .from('patrol_runs')
    .select('id, store_id, started_at')
    .eq('trigger', 'manual')
    .lt('started_at', settleBefore)
    .gt('started_at', dayAgo)
    .order('started_at', { ascending: false })
    .limit(50)

  let made = 0
  for (const r of runs ?? []) {
    // 既に生成済み？（period_from = started_at をキーに）
    const { data: rep } = await supa
      .from('security_reports')
      .select('id')
      .eq('store_id', r.store_id)
      .eq('period_from', r.started_at)
      .maybeSingle()
    if (rep) continue
    // findings が無い run は撮影失敗/撮影中 → まだレポート化しない
    const { count } = await supa
      .from('patrol_findings')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', r.id)
    if (!count) continue
    try {
      await generateAndStoreRunReport(supa, r.id as string)
      made++
    } catch {
      /* 次tickで再試行 */
    }
  }
  return made
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
