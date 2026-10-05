/**
 * /api/feedback — クラウドの画面から送る要望（基本設計 §3.1・テナント管理者だけ）
 *
 * POST: 要望 1 件を送る（source=cloud）。
 *   201 { id } / 400 invalid_body / 400 invalid_attachment（PNG・JPEG・WebP でない）/ 401 /
 *   403 forbidden（tenant_admin 以外）/ 409 feedback_disabled（テナントが止めている）/
 *   413 payload_too_large（画像が 3 MiB を超えた）/ 429 daily_limit（1 人 1 日 20 件）
 *   本文の形は 2 つ:
 *     - application/json             … 画像なし（これまでどおり）
 *     - multipart/form-data          … `payload`（上の JSON の文字列）と `attachment`（画像 1 枚）
 *   画像は先頭の印で形式を決め、SHA-256 を計算して宣言の列に入れ、置き場
 *   （feedback-attachments の `<tenant_id>/<item_id>`）に置いてから行を入れる。
 *   該当の画面の URL（page_url）は画面の場所だけ残す（形の違うものは捨てる・GVMS_CLOUD_SPEC §12.2）。
 * GET:  自分のテナントの要望の一覧（状態・返事・対応した版・URL・画像の有無）。RLS 配下のセッションで読む。
 *       画像は GET /api/feedback/[id]/attachment（期限つきの URL へ 302）で見る。
 *
 * super_admin は運営の側なので送らない（要望ボードで扱う）。store_manager・viewer も送れない。
 * 本文は現場の受け口と同じく伏せ字にしてから保存する。
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { CloudFeedbackBody, USER_DAILY_LIMIT, jstDayStartIso, sanitizeContext } from '@/lib/feedback/schema'
import { redactFeedbackText } from '@/lib/feedback/redact'
import { loadTenantFeedbackFlag, readBytesLimited, readJsonBody } from '@/lib/feedback/intake'
import { notifyBlockingFeedback } from '@/lib/feedback/notify'
import { ATTACHMENT_MAX_BYTES, type AttachmentType, cleanPageUrl, detectImageType, sha256Hex } from '@/lib/feedback/image'
import { attachmentObjectPath, putAttachment, removeAttachments } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 200
/** 画像つきの本文の上限: 画像 3 MiB ＋ 文と multipart の区切りの余裕 */
const MULTIPART_MAX_BYTES = ATTACHMENT_MAX_BYTES + 64 * 1024

type Parsed =
  | { ok: true; value: unknown; image: Uint8Array | null }
  | { ok: false; status: 400 | 413; error: string }

/** 本文を読む（JSON か、payload と attachment の multipart） */
async function readFeedbackRequest(req: NextRequest): Promise<Parsed> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase()
  if (!ct.startsWith('multipart/form-data')) {
    const raw = await readJsonBody(req)
    return raw.ok ? { ok: true, value: raw.value, image: null } : raw
  }
  const raw = await readBytesLimited(req, MULTIPART_MAX_BYTES)
  if (!raw.ok) return raw
  let form: FormData
  try {
    const buf = new Uint8Array(raw.bytes.byteLength)
    buf.set(raw.bytes)
    form = await new Response(buf.buffer, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData()
  } catch {
    return { ok: false, status: 400, error: 'invalid_body' }
  }
  const payload = form.get('payload')
  if (typeof payload !== 'string') return { ok: false, status: 400, error: 'invalid_body' }
  let value: unknown
  try { value = JSON.parse(payload) } catch { return { ok: false, status: 400, error: 'invalid_body' } }
  const file = form.get('attachment')
  if (file === null) return { ok: true, value, image: null }
  if (typeof file === 'string') return { ok: false, status: 400, error: 'invalid_attachment' }
  if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, status: 413, error: 'payload_too_large' }
  if (file.size === 0) return { ok: false, status: 400, error: 'invalid_attachment' }
  return { ok: true, value, image: new Uint8Array(await file.arrayBuffer()) }
}

export async function POST(req: NextRequest) {
  const guard = await requireTenantAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const tenantId = guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const raw = await readFeedbackRequest(req)
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status })
  const parsed = CloudFeedbackBody.safeParse(raw.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const b = parsed.data
  // 画像は先頭の印で形式を決める（ブラウザが付けた種類は信じない）
  let image: { bytes: Uint8Array; type: AttachmentType; sha256: string } | null = null
  if (raw.image) {
    const type = detectImageType(raw.image)
    if (!type) return NextResponse.json({ error: 'invalid_attachment' }, { status: 400 })
    image = { bytes: raw.image, type, sha256: await sha256Hex(raw.image) }
  }

  // ガードを通ってから service role を組み立てる（書き込みポリシーは置いていない）。
  const svc = createSupabaseService()

  const tenant = await loadTenantFeedbackFlag(svc, tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 500 })
  if (!tenant.enabled) return NextResponse.json({ error: 'feedback_disabled' }, { status: 409 })

  const { count, error: countErr } = await svc
    .from('feedback_items')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by', guard.user.id)
    .gte('created_at', jstDayStartIso())
  if (countErr) return NextResponse.json({ error: 'count_failed' }, { status: 500 })
  if ((count ?? 0) >= USER_DAILY_LIMIT) return NextResponse.json({ error: 'daily_limit' }, { status: 429 })

  const body = redactFeedbackText(b.body)
  // 画像は先に置く（行の id を先に決める）。行を入れられなければ置いた画像を消す。
  const itemId = randomUUID()
  const path = image ? attachmentObjectPath(tenantId, itemId) : null
  if (image && path) {
    const putErr = await putAttachment(svc, path, image.bytes, image.type)
    if (putErr) return NextResponse.json({ error: 'store_failed' }, { status: 500 })
  }
  const { data: ins, error: insErr } = await svc
    .from('feedback_items')
    .insert({
      id: itemId,
      tenant_id: tenantId,
      store_id: null,
      edge_id: null,
      source: 'cloud',
      local_id: null,
      submitted_by: guard.user.id,
      kind: b.kind,
      urgency: b.urgency,
      body,
      contact_ok: b.contact_ok,
      role: 'tenant_admin',
      context: sanitizeContext(b.context),
      submitted_at: new Date().toISOString(),
      page_url: cleanPageUrl(b.page_url),
      attachment_type: image?.type ?? null,
      attachment_size: image?.bytes.byteLength ?? null,
      attachment_sha256: image?.sha256 ?? null,
      attachment_path: path,
      attachment_received_at: image ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (insErr || !ins) {
    if (path) await removeAttachments(svc, [path])
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  if (b.urgency === 'blocking') {
    await notifyBlockingFeedback({ tenantName: tenant.name, storeName: null, source: 'cloud', kind: b.kind, body })
  }

  return NextResponse.json({ id: (ins as { id: string }).id }, { status: 201 })
}

export async function GET() {
  const guard = await requireTenantAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const tenantId = guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // RLS（feedback_items_select: tenant_admin は自分のテナントだけ）の上で、さらにテナントで絞る。
  const { data, error } = await guard.supa
    .from('feedback_items')
    .select('id, source, store_id, kind, urgency, body, contact_ok, status, reply, fixed_version, submitted_at, created_at, updated_at, page_url, attachment_type, attachment_path, attachment_purged_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  // 置き場の場所は外へ出さない（画像は /api/feedback/[id]/attachment で見る）
  const items = ((data ?? []) as Record<string, unknown>[]).map(({ attachment_path, attachment_purged_at, ...rest }) => ({
    ...rest,
    has_attachment: !!attachment_path,
    attachment_purged: !!attachment_purged_at,
  }))
  return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } })
}
