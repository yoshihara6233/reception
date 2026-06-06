/**
 * F82 / Phase 8.7 — VOD クリップ自動削除
 *
 * POST /api/admin/vod/cleanup
 *   body (任意): { dry_run?: boolean, older_than_days?: number }
 *
 * 概要
 *   `vod_clips.created_at` が `older_than_days` 日より古い行を対象に、
 *   Storage オブジェクト + DB 行を両方削除する。
 *
 *   - `older_than_days` 既定値: 30
 *   - `dry_run`: true なら削除せず、対象件数のみ返す
 *
 * 認証
 *   - 通常の Supabase session で super_admin or tenant_admin のみ実行可
 *   - ヘッダ `x-cron-secret: $CRON_SECRET` で認証バイパス可 (Vercel Cron / pg_cron 用)
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
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

const BUCKET                = 'vod-clips'
const DEFAULT_TTL_DAYS      = 30
const MAX_DELETE_PER_RUN    = 500

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
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body
  const ttlDays = Number(body.older_than_days ?? DEFAULT_TTL_DAYS)
  const dryRun  = Boolean(body.dry_run)

  if (!Number.isFinite(ttlDays) || ttlDays < 1) {
    return NextResponse.json({ error: 'invalid_ttl' }, { status: 400 })
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  // Cron 経由は ヘッダ secret で認証バイパス。
  const cronSecret = process.env.CRON_SECRET
  const isCron     = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret

  if (!isCron) {
    // 通常 UI 経由はログイン済 + admin role を要求
    const supa = await createSupabaseServer()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    // admin_users.role が super_admin or tenant_admin であることを確認
    const { data: au } = await supa
      .from('admin_users')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = au?.role
    if (role !== 'super_admin' && role !== 'tenant_admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

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
