/**
 * DELETE /api/admin/nvmsd-releases/[id] — リリースの取り下げ
 *
 * その配布物を受け取るエッジ（目標版が一致し、形式・arch も一致）が居る間は消せない
 * （配信が黙って 204 に化ける事故の防止）。実体（storage）→ 台帳の順に消す。
 * 名乗りの無いエッジは deb / amd64 扱い。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { NVMSD_RELEASES_BUCKET, edgePkg } from '@/lib/admin/nvmsd-releases'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()

  const { data: rel } = await svc
    .from('nvmsd_releases')
    .select('id, version, storage_path, pkg_format, pkg_arch')
    .eq('id', id)
    .maybeSingle()
  if (!rel) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: targets } = await svc
    .from('edge_devices')
    .select('pkg_format, pkg_arch')
    .eq('desired_agent_version', rel.version)
    .limit(10000)
  const count = (targets ?? []).filter((e) => {
    const p = edgePkg(e)
    return p.format === rel.pkg_format && p.arch === rel.pkg_arch
  }).length
  if (count > 0) {
    return NextResponse.json({ error: 'in_use', edges: count }, { status: 409 })
  }

  await svc.storage.from(NVMSD_RELEASES_BUCKET).remove([rel.storage_path])
  const { error } = await svc.from('nvmsd_releases').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
