/**
 * POST /api/edge/feedback — 現場（G・VMS の管理者）からの要望 1 件（GVMS_CLOUD_SPEC §12.2）
 *
 * 窓口ノードが 1 分ごとに未送信を送る。失敗は次の周期で送り直すので、
 * **同じ (拠点, local_id) は 200 で同じ id を返す**（送り直しで増えない）。
 *
 * 応答:
 *   201 { id, attachment_needed }      受け付けた
 *   200 { id, attachment_needed }      同じ local_id を受け付け済み
 *   400 { error: 'invalid_body' }      形が違う（本文 1〜1,000 字・kind・urgency・local_id）
 *   401                                トークンが違う
 *   403 { error: 'role_not_allowed' }  role が admin でない（§12.1: 書けるのは拠点の管理者だけ）
 *   409 { error: 'feedback_disabled' } テナントが要望の受付を止めている（拠点は 7 日送らない）
 *   413 { error: 'payload_too_large' }
 *   429 { error: 'daily_limit' }       1 拠点 1 日 50 件を超えた（拠点は翌日に送る）
 *
 * 本文は電話番号・メールアドレス・URL・IP アドレスを伏せ字にして保存する（元の文は残さない）。
 * context は既知の項目だけ残す（知らない項目は捨てる・拒否しない）。
 * urgency=blocking は運用アラート（ALERT_EMAILS / ALERT_WEBHOOK_URL）で運営へすぐ知らせる。
 * 誰が書いたかは受けない（拠点と役割だけ・§12.1）。
 *
 * 該当の画面の URL（page_url・§12.2）は画面の場所だけ残す（http(s) の URL ならパスとクエリと
 * ハッシュだけにし、形の違うものは捨てる・拒否しない）。
 *
 * 画像（attachment・§12.6）はここでは宣言 { type, size, sha256 } だけ受ける。中身は
 * PUT /api/edge/feedback/attachment で別に送る。attachment_needed は、宣言があり、
 * 同じ sha256 の中身をまだ受けていないとき true。**送り直しの 200 でも返す**
 * （本文は届いたが画像がまだのとき、拠点はそれを見て送る）。
 *   - 送り直しで宣言が変わったとき: 中身をまだ受けていなければ新しい宣言に置き換える
 *     （拠点の手元の画像が正）。受けた後・1 年で消した後は最初のものを変えない（false を返す）
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { EdgeFeedbackBody, EDGE_DAILY_LIMIT, jstDayStartIso, parseTimestamp, sanitizeContext } from '@/lib/feedback/schema'
import { redactFeedbackText } from '@/lib/feedback/redact'
import { loadTenantFeedbackFlag, readJsonBody } from '@/lib/feedback/intake'
import { notifyBlockingFeedback } from '@/lib/feedback/notify'
import { AttachmentDecl, cleanPageUrl } from '@/lib/feedback/image'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const raw = await readJsonBody(req)
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status })
  const parsed = EdgeFeedbackBody.safeParse(raw.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const b = parsed.data
  if (b.role !== 'admin') return NextResponse.json({ error: 'role_not_allowed' }, { status: 403 })
  // 画像の宣言の形が違うときは、**宣言だけを捨てて要望は受ける**（page_url と同じ扱い・§2 の
  // 「知らないものは捨てて拒否しない」）。400 で断ると、拠点はその要望を届くまで送り直し続け、
  // 後ろに並んだ要望まで止まる（拠点は 1 件失敗するとその周期を打ち切る）。
  let decl: AttachmentDecl | null = null
  if (b.attachment !== undefined && b.attachment !== null) {
    const d = AttachmentDecl.safeParse(b.attachment)
    if (d.success) decl = d.data
  }

  const svc = createSupabaseService()

  // 送り直し: 受け付け済みなら同じ id（上限・テナントの停止より先に見る — 既に届いたものは届いたまま）。
  const existing = await findExisting(svc, edge.id, b.local_id)
  if (existing.error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (existing.row) {
    const r = await resendAttachment(svc, existing.row, decl)
    if (r === null) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    return NextResponse.json({ id: existing.row.id, attachment_needed: r }, { status: 200 })
  }

  const { data: store, error: storeErr } = await svc
    .from('stores')
    .select('tenant_id, name')
    .eq('id', edge.store_id)
    .maybeSingle()
  if (storeErr || !store) return NextResponse.json({ error: 'store_not_found' }, { status: 500 })
  const { tenant_id: tenantId, name: storeName } = store as { tenant_id: string; name: string | null }

  const tenant = await loadTenantFeedbackFlag(svc, tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 500 })
  if (!tenant.enabled) return NextResponse.json({ error: 'feedback_disabled' }, { status: 409 })

  // 1 拠点 1 日 50 件（日本時間の 0:00 から数える）。窓口ノード単位で数える。
  const { count, error: countErr } = await svc
    .from('feedback_items')
    .select('id', { count: 'exact', head: true })
    .eq('edge_id', edge.id)
    .gte('created_at', jstDayStartIso())
  if (countErr) return NextResponse.json({ error: 'count_failed' }, { status: 500 })
  if ((count ?? 0) >= EDGE_DAILY_LIMIT) return NextResponse.json({ error: 'daily_limit' }, { status: 429 })

  const body = redactFeedbackText(b.body)
  const { data: ins, error: insErr } = await svc
    .from('feedback_items')
    .insert({
      tenant_id: tenantId,
      store_id: edge.store_id,
      edge_id: edge.id,
      source: 'gvms',
      local_id: b.local_id,
      submitted_by: null,
      kind: b.kind,
      urgency: b.urgency,
      body,
      contact_ok: b.contact_ok,
      role: 'admin',
      context: sanitizeContext(b.context),
      submitted_at: parseTimestamp(b.submitted_at),
      page_url: cleanPageUrl(b.page_url),
      attachment_type: decl?.type ?? null,
      attachment_size: decl?.size ?? null,
      attachment_sha256: decl?.sha256 ?? null,
    })
    .select('id')
    .single()
  if (insErr || !ins) {
    // 同時に 2 回届いた（一意の索引で片方が弾かれた）: 先に入った方の id を返す。
    if (insErr?.code === '23505') {
      const again = await findExisting(svc, edge.id, b.local_id)
      if (again.row) return NextResponse.json({ id: again.row.id, attachment_needed: needsAttachment(again.row) }, { status: 200 })
    }
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  if (b.urgency === 'blocking') {
    await notifyBlockingFeedback({ tenantName: tenant.name, storeName, source: 'gvms', kind: b.kind, body })
  }

  return NextResponse.json({ id: (ins as { id: string }).id, attachment_needed: decl !== null }, { status: 201 })
}

type Svc = ReturnType<typeof createSupabaseService>

interface ExistingRow {
  id: string
  attachment_type: string | null
  attachment_size: number | null
  attachment_sha256: string | null
  attachment_path: string | null
  attachment_purged_at: string | null
}

async function findExisting(svc: Svc, edgeId: string, localId: string): Promise<{ row: ExistingRow | null; error: boolean }> {
  const { data, error } = await svc
    .from('feedback_items')
    .select('id, attachment_type, attachment_size, attachment_sha256, attachment_path, attachment_purged_at')
    .eq('edge_id', edgeId)
    .eq('local_id', localId)
    .maybeSingle()
  if (error) return { row: null, error: true }
  return { row: (data as ExistingRow | null) ?? null, error: false }
}

/** 保存している宣言に対して、中身をまだ受けていないか */
function needsAttachment(row: ExistingRow): boolean {
  return !!row.attachment_sha256 && !row.attachment_path && !row.attachment_purged_at
}

/**
 * 送り直しのときの attachment_needed。中身をまだ受けておらず、宣言が変わっていれば置き換える。
 * 書き込みに失敗したら null。
 */
async function resendAttachment(svc: Svc, row: ExistingRow, decl: AttachmentDecl | null): Promise<boolean | null> {
  if (!decl) return needsAttachment(row)
  // 受けた後・消した後は最初のものを変えない（受けた中身と同じなら false・違っても受け直さない）
  if (row.attachment_path || row.attachment_purged_at) return false
  const same = row.attachment_sha256 === decl.sha256 && row.attachment_type === decl.type && row.attachment_size === decl.size
  if (!same) {
    const { error } = await svc
      .from('feedback_items')
      .update({ attachment_type: decl.type, attachment_size: decl.size, attachment_sha256: decl.sha256 })
      .eq('id', row.id)
      .is('attachment_path', null)
    if (error) return null
  }
  return true
}
