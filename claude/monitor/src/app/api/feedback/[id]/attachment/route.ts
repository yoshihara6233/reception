/**
 * GET /api/feedback/[id]/attachment — 要望に添えた画像を見る（テナント管理者・自分のテナントだけ）
 *
 * 期限つきの URL（5 分）へ 302。一覧の見本（<img>）と「開く」（新しいタブ）の両方で使う。
 * 先に RLS 配下のセッションで要望を読み（feedback_items_select: tenant_admin は自分のテナントだけ）、
 * 見えたものだけ service role で署名する（ID を知っていても他テナントの画像には届かない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { signAttachmentUrl } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireTenantAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const tenantId = guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data, error } = await guard.supa
    .from('feedback_items')
    .select('id, attachment_path')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  const path = (data as { attachment_path: string | null } | null)?.attachment_path
  if (!path) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = await signAttachmentUrl(createSupabaseService(), path)
  if (!url) return NextResponse.json({ error: 'sign_failed' }, { status: 500 })
  const res = NextResponse.redirect(url, 302)
  res.headers.set('cache-control', 'no-store')
  return res
}
