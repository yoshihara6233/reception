/**
 * F82 / Phase 8.7 — VOD クリップ自動削除
 *
 * GET  /api/admin/vod/cleanup   (Vercel Cron・`Authorization: Bearer $CRON_SECRET`・既定の保持日数で消す)
 * POST /api/admin/vod/cleanup   body (任意): { dry_run?: boolean, older_than_days?: number }
 *
 * 概要
 *   `vod_clips.created_at` が `older_than_days` 日より古い行を対象に、
 *   Storage オブジェクト + DB 行を両方削除する。
 *
 *   - `older_than_days` 既定値: 31（データガバナンス方針: 保持31日）
 *   - `dry_run`: true なら削除せず、対象件数のみ返す
 *
 * 認証 (2026-10-29 に直した)
 *   - Cron: `Authorization: Bearer $CRON_SECRET` (Vercel Cron の形) か `x-cron-secret: $CRON_SECRET` (pg_cron など)
 *   - 手で呼ぶのは運営 (super_admin) だけ。全テナントの行を消すので、テナント管理者には開けない
 *   - `older_than_days` は保持日数 (31 日) より短くできない (保持の決まりより早く消させない)
 *
 *   **以前は POST と `x-cron-secret` しか受けず、Vercel Cron (GET・Bearer) からの日次の呼び出しは 405 で、
 *   一度も動いていなかった** (自主診断の文書づくりで見つけた)。そのため 31 日を過ぎたクリップ・発報の
 *   静止画、180 日を過ぎた閲覧の記録、古い回数の制限の行が残っていた。直した後の最初の実行で、
 *   たまった分を MAX_DELETE_PER_RUN ずつ消していく
 *
 * スケジュール (本番)
 *   Vercel Cron で日次起動を想定:
 *     // vercel.json
 *     {
 *       "crons": [{
 *         "path": "/api/admin/vod/cleanup",
 *         "schedule": "0 3 * * *"
 *       }]
 *     }
 *   または Supabase pg_cron で `select cron.schedule('vod-cleanup', '0 3 * * *', $$ ... $$);`
 *
 * 安全装置
 *   - 1 回の実行で削除する最大件数 (`MAX_DELETE_PER_RUN`) 制限あり
 *   - status='uploading' の行はスキップ (進行中のジョブが消えるのを防ぐ)
 *   - Storage 削除失敗時も DB 行は残す → 次回再試行可能
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { requireSuperAdmin } from '@/lib/admin/guard'

const BUCKET                = 'vod-clips'
const SNAPSHOT_BUCKET       = 'security-snapshots'
const DEFAULT_TTL_DAYS      = 31   // データガバナンス方針: 保持31日（docs/data-governance-sla.md）
const MAX_DELETE_PER_RUN    = 500
// 映像閲覧アクセスログ(G3)は監査用途のため映像本体より長く保持する（180日）。
const FOOTAGE_LOG_TTL_DAYS  = 180

interface AlarmPruneResult {
  frames_scanned:   number
  frames_deleted:   number
  snapshots_pruned: number
  failed:           number
}

/**
 * 発報系の保存物を pruning する（是正4）。
 *  - alarm_frames（PB7 前後スナップ・全カメラ×8点/発報）: cutoff より古い行を
 *    Storage(security-snapshots) + DB 行ごと削除。1発報=最大 カメラ数×8 枚のため
 *    放置すると Storage が無限成長する。
 *  - alarm_events の発報時スナップ（alarms/<id>.jpg|png）: 画像のみ削除し
 *    snapshot_url を NULL に。行は監査証跡として残す。
 * 失敗は failed に計上して次回再試行（DB 行は Storage 削除成功後にのみ消す）。
 */
async function pruneAlarmArtifacts(
  admin: SupabaseClient,
  cutoffIso: string,
  dryRun: boolean,
): Promise<AlarmPruneResult> {
  const out: AlarmPruneResult = { frames_scanned: 0, frames_deleted: 0, snapshots_pruned: 0, failed: 0 }

  // ── alarm_frames ──
  const { data: frames } = await admin
    .from('alarm_frames')
    .select('id, storage_path')
    .lt('created_at', cutoffIso)
    .limit(MAX_DELETE_PER_RUN)
  const frameRows = frames ?? []
  out.frames_scanned = frameRows.length

  if (!dryRun && frameRows.length > 0) {
    const paths = frameRows.filter((r) => r.storage_path).map((r) => r.storage_path as string)
    let storageOk = true
    if (paths.length > 0) {
      const { error } = await admin.storage.from(SNAPSHOT_BUCKET).remove(paths)
      if (error) {
        console.error('[vod/cleanup] alarm_frames storage remove failed:', error.message)
        out.failed += paths.length
        storageOk = false
      }
    }
    if (storageOk) {
      const { error } = await admin.from('alarm_frames').delete().in('id', frameRows.map((r) => r.id))
      if (error) {
        console.error('[vod/cleanup] alarm_frames db delete failed:', error.message)
        out.failed += frameRows.length
      } else {
        out.frames_deleted = frameRows.length
      }
    }
  }

  // ── 発報時スナップ（行は残し画像のみ）──
  const { data: evs } = await admin
    .from('alarm_events')
    .select('id')
    .lt('occurred_at', cutoffIso)
    .not('snapshot_url', 'is', null)
    .limit(MAX_DELETE_PER_RUN)
  const evRows = evs ?? []

  if (dryRun) {
    out.snapshots_pruned = evRows.length // dry_run では対象件数を返す
  } else if (evRows.length > 0) {
    // 拡張子は jpg/png のどちらか（upload時に決定）。存在しない方の remove は無害。
    const paths = evRows.flatMap((e) => [`alarms/${e.id}.jpg`, `alarms/${e.id}.png`])
    const { error } = await admin.storage.from(SNAPSHOT_BUCKET).remove(paths)
    if (error) {
      console.error('[vod/cleanup] alarm snapshot storage remove failed:', error.message)
      out.failed += evRows.length
    } else {
      const { error: upErr } = await admin
        .from('alarm_events')
        .update({ snapshot_url: null })
        .in('id', evRows.map((e) => e.id))
      if (upErr) {
        console.error('[vod/cleanup] alarm snapshot_url clear failed:', upErr.message)
        out.failed += evRows.length
      } else {
        out.snapshots_pruned = evRows.length
      }
    }
  }

  return out
}

interface Body {
  dry_run?:        boolean
  older_than_days?: number
}

interface DeleteResult {
  scanned:        number
  deleted:        number
  storage_failed: number
  db_failed:      number
  dry_run:        boolean
  cutoff_iso:     string
  paths:          string[]
  alarms?:        AlarmPruneResult
}

/** Cron の呼び出しか (Vercel Cron の Bearer か、x-cron-secret)。定数時間で比べる。 */
function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const same = (a: string | null, b: string) => {
    if (a === null) return false
    const x = Buffer.from(a), y = Buffer.from(b)
    return x.length === y.length && timingSafeEqual(x, y)
  }
  return same(req.headers.get('authorization'), `Bearer ${secret}`) || same(req.headers.get('x-cron-secret'), secret)
}

/** Vercel Cron の日次の呼び出し (GET)。既定の保持日数で消す。 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return runCleanup(DEFAULT_TTL_DAYS, false)
}

/** 手での実行 (運営だけ) と、POST で呼ぶ Cron (pg_cron など)。 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body
  const ttlDays = Number(body.older_than_days ?? DEFAULT_TTL_DAYS)
  const dryRun  = Boolean(body.dry_run)

  // 保持の決まり (31 日) より早くは消させない
  if (!Number.isFinite(ttlDays) || ttlDays < DEFAULT_TTL_DAYS) {
    return NextResponse.json({ error: 'invalid_ttl' }, { status: 400 })
  }
  if (!isCronRequest(req)) {
    // 全テナントの行を消すので運営だけ (以前は tenant_admin も呼べ、admin_users を id で引いていた)
    const guard = await requireSuperAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  return runCleanup(ttlDays, dryRun)
}

async function runCleanup(ttlDays: number, dryRun: boolean): Promise<NextResponse> {
  // ── Service Role client for DB + Storage ────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── 1. Cutoff を計算 + 対象行を取得 ─────────────────────────────────────
  const cutoffMs  = Date.now() - ttlDays * 24 * 60 * 60 * 1000
  const cutoffIso = new Date(cutoffMs).toISOString()

  // status='uploading' は進行中なので除外。それ以外 (queued/ready/failed) は
  // 古ければ削除対象。
  const { data: targets, error: targetsErr } = await admin
    .from('vod_clips')
    .select('id, storage_path, status')
    .lt('created_at', cutoffIso)
    .neq('status', 'uploading')
    .limit(MAX_DELETE_PER_RUN)

  if (targetsErr) {
    return NextResponse.json(
      { error: 'query_failed', detail: targetsErr.message },
      { status: 500 },
    )
  }
  const rows = targets ?? []

  const result: DeleteResult = {
    scanned:        rows.length,
    deleted:        0,
    storage_failed: 0,
    db_failed:      0,
    dry_run:        dryRun,
    cutoff_iso:     cutoffIso,
    paths:          [],
  }

  // ── 発報系（alarm_frames / 発報スナップ）の pruning（是正4・VOD と同じ TTL）──
  result.alarms = await pruneAlarmArtifacts(admin, cutoffIso, dryRun)

  // ── 映像閲覧アクセスログ(G3) の pruning（監査用途のため180日保持・DB行のみ）──
  if (!dryRun) {
    const footageCutoff = new Date(Date.now() - FOOTAGE_LOG_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { error: falErr } = await admin.from('footage_access_log').delete().lt('accessed_at', footageCutoff)
    if (falErr) console.error('[vod/cleanup] footage_access_log prune failed:', falErr.message)

    // レート制限カウンタ（無認証ルート用）。窓は 1 時間なので 1 日残れば十分。
    // これを回さないと、見たメールアドレス・IP の分だけ行が増え続ける。
    const rlCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { error: rlErr } = await admin.from('rate_limits').delete().lt('window_start', rlCutoff)
    if (rlErr) console.error('[vod/cleanup] rate_limits prune failed:', rlErr.message)

    // 命令の受領記録（edge_command_runs）。証跡が欠けたときに
    // 「命令が届かなかった」のか「届いたが撮れなかった」のかを切り分けるための
    // 診断用データなので、14 日あれば足りる。回さないと命令の数だけ増え続ける。
    const { error: ecrErr } = await admin.rpc('prune_edge_command_runs', { p_days: 14 })
    if (ecrErr) console.error('[vod/cleanup] edge_command_runs prune failed:', ecrErr.message)
  }

  if (dryRun || rows.length === 0) {
    result.paths = rows
      .filter((r) => r.storage_path)
      .map((r) => r.storage_path as string)
      .slice(0, 50)  // dryRun 出力サンプルは 50 件まで
    return NextResponse.json(result)
  }

  // ── 2. Storage オブジェクトを一括削除 ──────────────────────────────────
  const storagePaths = rows
    .filter((r) => r.storage_path)
    .map((r) => r.storage_path as string)

  if (storagePaths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(storagePaths)
    if (rmErr) {
      // Storage 削除失敗時は DB 行を残す → 次回再試行可能
      console.error('[vod/cleanup] storage remove failed:', rmErr.message)
      result.storage_failed = storagePaths.length
      return NextResponse.json(result, { status: 502 })
    }
  }

  // ── 3. DB 行を削除 ─────────────────────────────────────────────────────
  const ids = rows.map((r) => r.id)
  const { error: delErr } = await admin
    .from('vod_clips')
    .delete()
    .in('id', ids)

  if (delErr) {
    console.error('[vod/cleanup] db delete failed:', delErr.message)
    result.db_failed = ids.length
    return NextResponse.json(result, { status: 500 })
  }

  result.deleted = ids.length
  return NextResponse.json(result)
}
