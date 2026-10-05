/**
 * POST /api/admin/feedback/import — 閉域の拠点が書き出した要望のファイルを取り込む（super_admin 専用）
 *
 * アップリンクが無い拠点は、G・VMS の 設定 → 要望 で JSON に書き出し、販売店経由で届ける
 * （基本設計 §3.3）。運営が取り込む先のテナントと拠点を選んで入れる。
 *
 * 本文: { tenant_id, store_id, file: { format: 'gvms-feedback-export/1', site: {...}, items: [§12.2 と同じ形] } }
 * 応答: 200 { imported, duplicates, invalid: [{ index, reason }],
 *             attachments: { stored, dropped: [{ index, reason }] } }
 *
 * - source=import・edge_id なし。**同じ拠点の同じ local_id は入れない**（2 回取り込んでも増えない。
 *   あとでアップリンクで届いた分とも重ならない）。
 * - 1 件ずつ §12.2 と同じ決まりで検証する（role=admin 以外・本文の形の誤りは飛ばして理由を返す）。
 * - 本文は伏せ字にしてから保存する。site の中身（拠点の名前など）は保存しない。
 * - テナントの「要望の受付を止める」は見ない（運営が意図して取り込む操作のため）。
 * - page_url は現場の受け口と同じく画面の場所だけ残す（形の違うものは捨てる）。
 * - 画像（GVMS_CLOUD_SPEC §12.6）: 各要望の attachment: { type, size, sha256, data_base64 } を
 *   base64 から戻し、大きさ・先頭の印・sha256 が宣言と合うものだけ置く。**合わないものは画像だけ
 *   捨てて要望は入れる**（attachments.dropped に index と理由を返す）。
 * - Vercel の関数の本文の上限（4.5 MB）があるので、画面は大きなファイルを数回に分けて送る
 *   （画像つきの要望は 1 回に 1 件ずつ）。index は送った items の中での番号。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'
import { EdgeFeedbackBody, parseTimestamp, sanitizeContext } from '@/lib/feedback/schema'
import { redactFeedbackText } from '@/lib/feedback/redact'
import { readJsonBody } from '@/lib/feedback/intake'
import { AttachmentDecl, cleanPageUrl, checkAttachment, decodeBase64Strict, type AttachmentMismatch } from '@/lib/feedback/image'
import { attachmentObjectPath, putAttachment } from '@/lib/feedback/attachment-store'

export const dynamic = 'force-dynamic'

const IMPORT_FORMAT = 'gvms-feedback-export/1'
const MAX_ITEMS = 2000
/** 1,000 字 × 2,000 件に余裕を見た大きさ */
const MAX_BYTES = 8 * 1024 * 1024

const Body = z.object({
  tenant_id: z.string().uuid(),
  store_id: z.string().uuid(),
  file: z.object({
    format: z.literal(IMPORT_FORMAT),
    items: z.array(z.unknown()).max(MAX_ITEMS),
  }).passthrough(),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const raw = await readJsonBody(req, MAX_BYTES)
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status })
  const parsed = Body.safeParse(raw.value)
  if (!parsed.success) {
    const fmt = (raw.value as { file?: { format?: unknown } } | null)?.file?.format
    return NextResponse.json({ error: fmt !== undefined && fmt !== IMPORT_FORMAT ? 'unknown_format' : 'invalid_body' }, { status: 400 })
  }
  const { tenant_id: tenantId, store_id: storeId, file } = parsed.data

  const svc = createSupabaseService()
  const { data: store, error: storeErr } = await svc.from('stores').select('id, tenant_id').eq('id', storeId).maybeSingle()
  if (storeErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!store || (store as { tenant_id: string }).tenant_id !== tenantId) {
    return NextResponse.json({ error: 'store_tenant_mismatch' }, { status: 400 })
  }

  // 1 件ずつ検証（ファイルの中の重複も除く）
  const invalid: { index: number; reason: string }[] = []
  const valid = new Map<string, { index: number; v: z.infer<typeof EdgeFeedbackBody> }>()
  file.items.forEach((it, index) => {
    const r = EdgeFeedbackBody.safeParse(it)
    if (!r.success) { invalid.push({ index, reason: 'invalid_item' }); return }
    if (r.data.role !== 'admin') { invalid.push({ index, reason: 'role_not_allowed' }); return }
    if (!valid.has(r.data.local_id)) valid.set(r.data.local_id, { index, v: r.data })
  })
  let duplicates = file.items.length - invalid.length - valid.size

  // 既に入っている local_id（同じ拠点・出どころは問わない）を除く
  const ids = [...valid.keys()]
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const { data: existing, error } = await svc
      .from('feedback_items').select('local_id').eq('store_id', storeId).in('local_id', chunk)
    if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    for (const e of (existing ?? []) as { local_id: string }[]) {
      if (valid.delete(e.local_id)) duplicates += 1
    }
  }

  // 画像を確かめる（合わないものは画像だけ捨てる）
  const ordered = [...valid.values()].sort((a, b) => a.index - b.index)
  const dropped: { index: number; reason: string }[] = []
  const images = new Map<string, { decl: AttachmentDecl; bytes: Uint8Array; index: number }>()
  for (const { index, v } of ordered) {
    if (v.attachment === undefined || v.attachment === null) continue
    const r = await readImportAttachment(v.attachment)
    if ('reason' in r) dropped.push({ index, reason: r.reason })
    else images.set(v.local_id, { ...r, index })
  }

  const rows = ordered.map(({ v }) => ({
    tenant_id: tenantId,
    store_id: storeId,
    edge_id: null,
    source: 'import',
    local_id: v.local_id,
    submitted_by: null,
    kind: v.kind,
    urgency: v.urgency,
    body: redactFeedbackText(v.body),
    contact_ok: v.contact_ok,
    role: 'admin',
    context: sanitizeContext(v.context),
    submitted_at: parseTimestamp(v.submitted_at),
    page_url: cleanPageUrl(v.page_url),
    attachment_type: images.get(v.local_id)?.decl.type ?? null,
    attachment_size: images.get(v.local_id)?.decl.size ?? null,
    attachment_sha256: images.get(v.local_id)?.decl.sha256 ?? null,
  }))
  const inserted: { id: string; local_id: string }[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await svc.from('feedback_items').insert(rows.slice(i, i + 500)).select('id, local_id')
    if (error) return NextResponse.json({ error: 'insert_failed', imported: i }, { status: 500 })
    inserted.push(...((data ?? []) as { id: string; local_id: string }[]))
  }

  // 画像を置き、置けたら受けた時刻を書く。置けなければ宣言を外す（届かない画像を待たせない）
  let stored = 0
  for (const row of inserted) {
    const img = images.get(row.local_id)
    if (!img) continue
    const path = attachmentObjectPath(tenantId, row.id)
    const putErr = await putAttachment(svc, path, img.bytes, img.decl.type)
    const { error: updErr } = await svc
      .from('feedback_items')
      .update(putErr
        ? { attachment_type: null, attachment_size: null, attachment_sha256: null }
        : { attachment_path: path, attachment_received_at: new Date().toISOString() })
      .eq('id', row.id)
    if (putErr || updErr) dropped.push({ index: img.index, reason: 'attachment_store_failed' })
    else stored += 1
  }
  dropped.sort((a, b) => a.index - b.index)

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'feedback.import',
    targetType: 'store',
    targetId: storeId,
    storeId,
    changes: { imported: rows.length, duplicates, invalid: invalid.length, attachments_stored: stored, attachments_dropped: dropped.length },
  })

  return NextResponse.json({ imported: rows.length, duplicates, invalid, attachments: { stored, dropped } })
}

/** 書き出しファイルの画像の形（§12.6） */
const ImportAttachment = AttachmentDecl.extend({ data_base64: z.string() })

/** 画像を読み、宣言と合うか確かめる。合わなければ理由（attachment_ で始まる）を返す */
async function readImportAttachment(raw: unknown): Promise<
  { decl: AttachmentDecl; bytes: Uint8Array } | { reason: `attachment_${AttachmentMismatch | 'invalid' | 'base64'}` }
> {
  const p = ImportAttachment.safeParse(raw)
  if (!p.success) return { reason: 'attachment_invalid' }
  const { data_base64, ...decl } = p.data
  const bytes = decodeBase64Strict(data_base64)
  if (!bytes) return { reason: 'attachment_base64' }
  const mismatch = await checkAttachment(bytes, decl)
  if (mismatch) return { reason: `attachment_${mismatch}` }
  return { decl, bytes }
}
