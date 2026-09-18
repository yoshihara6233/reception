/**
 * nvmsd リリース台帳（OTA_SPEC §3）
 *
 * GET  — 一覧（エッジ詳細の目標版セレクトと台帳ページが使う）。
 * POST — 登録: upload-url 経由で PUT 済みの実体をサーバが読み戻して
 *        sha256・bytes を**実体から**計算し、署名（base64）と共に台帳へ載せる。
 *        申告値の sha256 は受けない（登録時の写し間違い・改ざんを台帳に固定しないため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  NVMSD_RELEASES_BUCKET,
  NVMSD_VERSION_RE,
  nvmsdReleasePath,
} from '@/lib/admin/nvmsd-releases'

export const dynamic = 'force-dynamic'
// 実体（〜数十 MB）を読み戻してハッシュするため、既定より長めに。
export const maxDuration = 60

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('nvmsd_releases')
    .select('id, version, sha256, bytes, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ releases: data ?? [] })
}

const PostBody = z.object({
  version: z.string().regex(NVMSD_VERSION_RE),
  // 署名は G・VMS の既存マニフェスト方式（付録A・2026-09-18 決定）:
  // `nvmsupd1.<base64 マニフェスト>.<base64 署名>` のドット区切り文字列。
  // クラウドは中身を解釈せず「文字列として預かってそのまま配る」——
  // ここで base64 だけに縛るとドットで弾いてしまうため、制御文字・空白の
  // 混入だけを拒む（印字可能 ASCII のみ）。
  sig: z.string().transform((s) => s.trim()).pipe(
    z.string().min(16).max(4096).regex(/^[\x21-\x7E]+$/),
  ),
  notes: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = PostBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { version, notes, sig } = parsed.data

  const svc = createSupabaseService()
  const path = nvmsdReleasePath(version)

  const { data: blob, error: dlErr } = await svc.storage
    .from(NVMSD_RELEASES_BUCKET)
    .download(path)
  if (dlErr || !blob) {
    return NextResponse.json({ error: 'binary_not_uploaded' }, { status: 400 })
  }

  const buf = Buffer.from(await blob.arrayBuffer())
  const sha256 = createHash('sha256').update(buf).digest('hex')

  const { error: insErr } = await svc.from('nvmsd_releases').insert({
    version,
    storage_path: path,
    sig,
    sha256,
    bytes: buf.length,
    notes: notes ?? null,
  })
  if (insErr) {
    const dup = insErr.code === '23505'
    return NextResponse.json(
      { error: dup ? 'version_exists' : insErr.message },
      { status: dup ? 409 : 500 },
    )
  }
  return NextResponse.json({ ok: true, version, sha256, bytes: buf.length })
}
