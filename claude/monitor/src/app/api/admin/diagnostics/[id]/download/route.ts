/**
 * GET /api/admin/diagnostics/[id]/download — 診断バンドルのダウンロード（super_admin）
 *
 * [id] = diagnostic_bundles.request_id。60 秒の署名 URL へ 302
 * （クリップのプロキシ /api/bcp/clip/[id] と同じ型。バンドルには
 * マスク済みとはいえ構成情報が入るので super_admin 限定）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BUCKET = 'diagnostics'
const URL_TTL_SEC = 60

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()
  const { data: bundle } = await svc
    .from('diagnostic_bundles')
    .select('request_id, status, storage_path')
    .eq('request_id', id)
    .maybeSingle()
  if (!bundle || bundle.status !== 'completed' || !bundle.storage_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: signed, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(bundle.storage_path, URL_TTL_SEC, {
      download: `diagnostics-${bundle.request_id}.tar.gz`,
    })
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'sign_failed' }, { status: 500 })
  }
  return NextResponse.redirect(signed.signedUrl, 302)
}
