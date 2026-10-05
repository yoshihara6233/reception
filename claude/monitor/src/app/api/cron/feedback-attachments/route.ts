/**
 * 要望の画像の片付け cron（1 日 1 回・GVMS_CLOUD_SPEC §12.6「受けてから 1 年で消す」）。
 *
 * 受けてから 365 日を過ぎた画像（attachment_received_at が 365 日より前）を Storage
 * （feedback-attachments）から消し、attachment_path と attachment_received_at を空にして
 * attachment_purged_at を書く。宣言（type・size・sha256）は残す（一覧で「保存期間を過ぎて
 * 消しました」と出し、拠点の送り直しで受け直さないため）。
 *
 * 1 回に 500 件ずつ、最大 20 回まで回す。消すのに失敗した分は行を書き換えず、次の実行で取り直す。
 *
 * 認証: 他の cron と同じ CRON_SECRET（Bearer / x-cron-secret）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { attachmentPurgeCutoff } from '@/lib/feedback/image'
import { removeAttachments } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const BATCH = 500
const MAX_ROUNDS = 20

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const now = new Date()
  const cutoff = attachmentPurgeCutoff(now).toISOString()

  let purged = 0
  let failed = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await svc
      .from('feedback_items')
      .select('id, attachment_path')
      .not('attachment_path', 'is', null)
      .lt('attachment_received_at', cutoff)
      .order('attachment_received_at', { ascending: true })
      .limit(BATCH)
    if (error) return NextResponse.json({ error: 'list_failed', purged, failed }, { status: 500 })
    const rows = (data ?? []) as { id: string; attachment_path: string }[]
    if (rows.length === 0) break

    const rmErr = await removeAttachments(svc, rows.map((r) => r.attachment_path))
    if (rmErr) { failed += rows.length; break } // 次の実行で取り直す

    const { error: updErr } = await svc
      .from('feedback_items')
      .update({ attachment_path: null, attachment_received_at: null, attachment_purged_at: now.toISOString() })
      .in('id', rows.map((r) => r.id))
    if (updErr) { failed += rows.length; break }
    purged += rows.length
    if (rows.length < BATCH) break
  }

  return NextResponse.json({ ok: true, purged, failed, cutoff })
}
