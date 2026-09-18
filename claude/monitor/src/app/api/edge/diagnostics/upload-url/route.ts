/**
 * POST /api/edge/diagnostics/upload-url — 診断バンドルのアップロード先
 *
 * DIAGNOSTICS_SPEC §2.3。管理画面の発行（collect_diagnostics コマンド）で
 * 先置きされた diagnostic_bundles の request_id だけに URL を出す —
 * エッジが勝手なパスへ書く経路を作らない（BCP の「計画に無い組は 404」と同じ型）。
 * 保存先はサーバが決める: <edge_id>/<request_id>.tar.gz（再試行は同じ場所に上書き）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const BUCKET = 'diagnostics'
// 仕様 §2.1 の既定上限（圧縮後 50 MiB）。超えそうなら nvmsd が古いログを削る。
const MAX_BYTES = 50 * 1024 * 1024

const Body = z.object({
  request_id: z.string().uuid(),
  bytes: z.number().int().min(1),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { request_id, bytes } = parsed.data

  if (bytes > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large', max_bytes: MAX_BYTES }, { status: 413 })
  }

  const svc = createSupabaseService()
  const { data: bundle } = await svc
    .from('diagnostic_bundles')
    .select('request_id, edge_id, status')
    .eq('request_id', request_id)
    .maybeSingle()
  // 発行の無い request_id・他エッジの分・決着済みは知らない扱い。
  if (!bundle || bundle.edge_id !== edge.id || bundle.status !== 'pending') {
    return NextResponse.json({ error: 'unknown_request' }, { status: 404 })
  }

  const path = `${edge.id}/${request_id}.tar.gz`
  const { data: signed, error } = await svc.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'sign_failed' }, { status: 500 })
  }

  await svc
    .from('diagnostic_bundles')
    .update({ bytes, storage_path: path })
    .eq('request_id', request_id)

  return NextResponse.json({ url: signed.signedUrl })
}
