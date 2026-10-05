/**
 * GET /api/admin/feedback/items/[id]/attachment — 要望に添えた画像を見る（super_admin・要望ボード）
 *
 * 期限つきの URL（5 分）へ 302。要望ボードの見本（<img>）と「開く」（新しいタブ）の両方で使う。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { signAttachmentUrl } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const svc = createSupabaseService()
  const { data, error } = await svc.from('feedback_items').select('id, attachment_path').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  const path = (data as { attachment_path: string | null } | null)?.attachment_path
  if (!path) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = await signAttachmentUrl(svc, path)
  if (!url) return NextResponse.json({ error: 'sign_failed' }, { status: 500 })
  const res = NextResponse.redirect(url, 302)
  res.headers.set('cache-control', 'no-store')
  return res
}
