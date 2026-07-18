/**
 * エッジがクリップ切り出し完了を報告する（T5）
 *
 * POST /api/v1/baggage/edge/clip-jobs/:id/complete
 *   ヘッダ: x-edge-token / x-edge-api-version
 *   body: { storagePath: string, durationSec: number, clockOffsetSec: number }
 *
 * サーバ側で健全性検査（尺80% / 時計ズレ閾値）を行う:
 *   - 合格 → inspection_clips を upsert・ジョブ done
 *   - 不合格 → リトライ（retry_count++・not_before を指数バックオフで後ろへ）。
 *     ただし deadline 超過なら failed 確定（管理者通知は T7 バッチ/通知基盤）。
 *
 * res: { ok, status: 'done'|'retry'|'failed', reasons? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateEdge } from '@/lib/edge/auth'
import {
  validateClipReport,
  nextRetryAt,
  isPastDeadline,
} from '@/lib/baggage/clip-jobs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateEdge(req.headers)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null) as
    | { storagePath?: string; durationSec?: number; clockOffsetSec?: number }
    | null

  if (!body || typeof body.storagePath !== 'string'
    || typeof body.durationSec !== 'number' || typeof body.clockOffsetSec !== 'number') {
    return NextResponse.json({ error: 'storagePath, durationSec, clockOffsetSec are required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: job } = await supabase
    .from('inspection_clip_jobs')
    .select('id, store_id, tenant_id, session_id, camera_id, window_from, window_to, deadline_at, retry_count')
    .eq('id', id)
    .maybeSingle()

  if (!job || job.store_id !== auth.storeId) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 })
  }

  const validation = validateClipReport({
    windowFrom: new Date(job.window_from),
    windowTo: new Date(job.window_to),
    reportedDurationSec: body.durationSec,
    clockOffsetSec: body.clockOffsetSec,
  })

  const now = new Date()

  // ── 合格: クリップ確定 ──────────────────────────────────────────────────
  if (validation.ok) {
    await supabase.from('inspection_clips').upsert({
      tenant_id: job.tenant_id,
      store_id: job.store_id,
      session_id: job.session_id,
      camera_id: job.camera_id,
      storage_path: body.storagePath,
      duration_sec: body.durationSec,
      clock_offset_sec: body.clockOffsetSec,
      upload_status: 'done',
    }, { onConflict: 'session_id,camera_id' })

    await supabase
      .from('inspection_clip_jobs')
      .update({ status: 'done', updated_at: now.toISOString() })
      .eq('id', id)

    return NextResponse.json({ ok: true, status: 'done' })
  }

  // ── 不合格: deadline 超過なら失敗確定、そうでなければリトライへ ──────────
  if (isPastDeadline(new Date(job.deadline_at), now)) {
    await supabase
      .from('inspection_clip_jobs')
      .update({ status: 'failed', updated_at: now.toISOString() })
      .eq('id', id)
    // 管理者通知は既存メール基盤 + 日次バッチ（T7）で拾う。
    return NextResponse.json({ ok: false, status: 'failed', reasons: validation.reasons })
  }

  const retryCount = (job.retry_count ?? 0) + 1
  await supabase
    .from('inspection_clip_jobs')
    .update({
      status: 'pending',
      retry_count: retryCount,
      not_before: nextRetryAt(retryCount, now).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', id)

  return NextResponse.json({ ok: false, status: 'retry', reasons: validation.reasons })
}
