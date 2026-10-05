/**
 * PUT /api/edge/feedback/attachment?local_id=<uuid> — 要望に添える画像 1 枚（GVMS_CLOUD_SPEC §12.6）
 *
 * 拠点は本文（POST /api/edge/feedback）を先に送り、応答の attachment_needed が true のとき、
 * 画像の中身をそのまま PUT する（`Content-Type` は宣言の type）。受けられるまで次の周期で送り直す。
 *
 * 応答:
 *   204                                受けた（同じ中身の送り直しも 204）
 *   400 { error: 'invalid_local_id' }  local_id が UUID でない
 *   400 { error: 'no_declaration' }    その要望に画像の宣言が無い
 *   400 { error: <理由> }              宣言と合わない（type_mismatch・size_mismatch・
 *                                      magic_mismatch・sha256_mismatch）
 *   401                                トークンが違う
 *   404 { error: 'not_found' }         その拠点のその local_id の要望が無い（先に本文を送る）
 *   409 { error: 'feedback_disabled' } テナントが要望の受付を止めている
 *   413 { error: 'payload_too_large' } 3 MiB を超えた（読みながら数えて止める）
 *
 * 置き場は非公開のバケット feedback-attachments の `<tenant_id>/<item_id>`。
 * 受けたら attachment_path と attachment_received_at を書く（ここから 1 年で消す）。
 * 1 年を過ぎて消した要望は受け直さない（204 を返して何もしない — 拠点の送り直しを止めるため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { loadTenantFeedbackFlag, readBytesLimited } from '@/lib/feedback/intake'
import { ATTACHMENT_MAX_BYTES, AttachmentDecl, checkAttachment } from '@/lib/feedback/image'
import { attachmentObjectPath, putAttachment } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const LocalId = z.string().uuid()

interface ItemRow {
  id: string
  tenant_id: string
  attachment_type: string | null
  attachment_size: number | null
  attachment_sha256: string | null
  attachment_path: string | null
  attachment_purged_at: string | null
}

const noContent = () => new NextResponse(null, { status: 204 })

export async function PUT(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const localId = LocalId.safeParse(req.nextUrl.searchParams.get('local_id'))
  if (!localId.success) return NextResponse.json({ error: 'invalid_local_id' }, { status: 400 })

  // 大きさを名乗っていれば、読む前に断る
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('feedback_items')
    .select('id, tenant_id, attachment_type, attachment_size, attachment_sha256, attachment_path, attachment_purged_at')
    .eq('edge_id', edge.id)
    .eq('local_id', localId.data)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  const item = data as ItemRow | null
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const tenant = await loadTenantFeedbackFlag(svc, item.tenant_id)
  if (!tenant) return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 500 })
  if (!tenant.enabled) return NextResponse.json({ error: 'feedback_disabled' }, { status: 409 })

  const body = await readBytesLimited(req, ATTACHMENT_MAX_BYTES)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })

  const decl = AttachmentDecl.safeParse({ type: item.attachment_type, size: item.attachment_size, sha256: item.attachment_sha256 })
  if (!decl.success) return NextResponse.json({ error: 'no_declaration' }, { status: 400 })

  // Content-Type は宣言の type（付いていれば合わせる。中身の判定は先頭の印で行う）
  const ct = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (ct && ct !== decl.data.type) return NextResponse.json({ error: 'type_mismatch' }, { status: 400 })

  const mismatch = await checkAttachment(body.bytes, decl.data)
  if (mismatch === 'too_large') return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 })

  // 同じ中身の送り直し・1 年で消した後: 何もしない
  if (item.attachment_path || item.attachment_purged_at) return noContent()

  const path = attachmentObjectPath(item.tenant_id, item.id)
  const putErr = await putAttachment(svc, path, body.bytes, decl.data.type)
  if (putErr) return NextResponse.json({ error: 'store_failed' }, { status: 500 })

  const { error: updErr } = await svc
    .from('feedback_items')
    .update({ attachment_path: path, attachment_received_at: new Date().toISOString() })
    .eq('id', item.id)
    .eq('attachment_sha256', decl.data.sha256)
  if (updErr) return NextResponse.json({ error: 'update_failed' }, { status: 500 })

  return noContent()
}
