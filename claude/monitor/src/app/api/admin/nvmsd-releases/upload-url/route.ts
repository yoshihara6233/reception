/**
 * POST /api/admin/nvmsd-releases/upload-url — リリースバイナリの直接アップロード先
 *
 * Vercel のリクエスト上限（数 MB）をバイナリが超えるため、API 経由で受けずに
 * ブラウザから Supabase Storage へ直接 PUT させる（BCP 証跡アップロードと同型）。
 * 流れ: ここで signed upload URL を得る → PUT → /api/admin/nvmsd-releases に
 * メタ登録（サーバが実体から sha256 を計算して台帳に載せる）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  NVMSD_RELEASES_BUCKET,
  NVMSD_RELEASE_MAX_BYTES,
  NVMSD_VERSION_RE,
  PKG_ARCHES,
  PKG_FORMATS,
  nvmsdReleasePath,
} from '@/lib/admin/nvmsd-releases'

export const dynamic = 'force-dynamic'

const Body = z.object({
  version: z.string().regex(NVMSD_VERSION_RE),
  bytes: z.number().int().min(1).max(NVMSD_RELEASE_MAX_BYTES),
  pkg_format: z.enum(PKG_FORMATS).default('deb'),
  pkg_arch: z.enum(PKG_ARCHES).default('amd64'),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { version, pkg_format, pkg_arch } = parsed.data

  const svc = createSupabaseService()
  const { data: dup } = await svc
    .from('nvmsd_releases')
    .select('id')
    .eq('version', version)
    .eq('pkg_format', pkg_format)
    .eq('pkg_arch', pkg_arch)
    .maybeSingle()
  if (dup) return NextResponse.json({ error: 'version_exists' }, { status: 409 })

  // 登録前の再アップロードはやり直せるよう upsert 可（台帳に載るまでは仮置き）。
  const path = nvmsdReleasePath(version, pkg_format, pkg_arch)
  const { data, error } = await svc.storage
    .from(NVMSD_RELEASES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'sign_failed' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl, path })
}
