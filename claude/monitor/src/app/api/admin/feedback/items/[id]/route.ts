/**
 * PATCH /api/admin/feedback/items/[id] — 要望 1 件の状態・返事・対応の版・束ね先を変える（super_admin 専用）
 *
 * - 見送り（declined）は返事が必須（基本設計 §3.6）。400 { error: 'reply_required' }
 * - topic_id を指定すると話題に束ねる（null で外す）。束ねると、要望は話題の状態を受け継ぐ
 *   （返事と対応の版は話題に値があるときだけ）。同じ本文で status 等を指定すれば、そちらが勝つ。
 * - 変更は feedback_events と運営アクセスログ（admin_audit_log）に残す。
 * - status / reply / fixed_version が変わると updated_at が進み、拠点の差分取得（§12.3）で返る。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'
import { FEEDBACK_STATUSES, declinedNeedsReply, fixedVersionSchema, replySchema } from '@/lib/feedback/schema'
import { inheritFromTopic, planCascade, type CascadePatch } from '@/lib/feedback/cascade'
import { SNAPSHOT_COLUMNS, recordFeedbackEvents, type ItemRow } from '@/lib/feedback/apply'

export const dynamic = 'force-dynamic'

const Body = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  reply: replySchema.optional(),
  fixed_version: fixedVersionSchema.optional(),
  topic_id: z.string().uuid().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, 'no_fields')

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const b = parsed.data

  const svc = createSupabaseService()
  const { data: itemData, error: itemErr } = await svc
    .from('feedback_items').select(SNAPSHOT_COLUMNS).eq('id', id).maybeSingle()
  if (itemErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!itemData) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const item = itemData as ItemRow

  // 束ね先の変更（話題の状態を受け継ぐ）
  let inherit: CascadePatch = {}
  const topicChanged = b.topic_id !== undefined && b.topic_id !== item.topic_id
  if (topicChanged && b.topic_id) {
    const { data: topic, error: topicErr } = await svc
      .from('feedback_topics').select('id, status, reply, fixed_version').eq('id', b.topic_id).maybeSingle()
    if (topicErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    if (!topic) return NextResponse.json({ error: 'topic_not_found' }, { status: 404 })
    inherit = inheritFromTopic(topic as { status: string; reply: string | null; fixed_version: string | null })
  }
  const explicit: CascadePatch = {}
  if (b.status !== undefined) explicit.status = b.status
  if (b.reply !== undefined) explicit.reply = b.reply
  if (b.fixed_version !== undefined) explicit.fixed_version = b.fixed_version
  const patch: CascadePatch = { ...inherit, ...explicit }

  // 明示した「見送り」に返事が無いのは誤り（受け継いだ値で起きる場合は planCascade が返事を残す）。
  const finalStatus = patch.status ?? item.status
  const finalReply = patch.reply !== undefined ? patch.reply : item.reply
  if (declinedNeedsReply(finalStatus, finalReply)) {
    return NextResponse.json({ error: 'reply_required' }, { status: 400 })
  }

  const [change] = planCascade(patch, [item])
  const update: Record<string, unknown> = { ...(change?.after ?? {}) }
  if (topicChanged) update.topic_id = b.topic_id ?? null
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, changed: false })

  const { data: updated, error: updErr } = await svc
    .from('feedback_items').update(update).eq('id', id)
    .select('id, status, reply, fixed_version, topic_id, updated_at').single()
  if (updErr || !updated) return NextResponse.json({ error: 'update_failed' }, { status: 500 })

  const newTopic = topicChanged ? (b.topic_id ?? null) : item.topic_id
  await recordFeedbackEvents(svc, [
    ...(topicChanged ? [{
      item_id: id, topic_id: newTopic ?? item.topic_id, actor_user_id: guard.user.id, action: 'item.bundle',
      before: { topic_id: item.topic_id }, after: { topic_id: newTopic },
    }] : []),
    ...(change ? [{
      item_id: id, topic_id: newTopic, actor_user_id: guard.user.id, action: 'item.update',
      before: change.before, after: change.after,
    }] : []),
  ])
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: topicChanged ? 'feedback.item.bundle' : 'feedback.item.update',
    targetType: 'feedback_item',
    targetId: id,
    storeId: item.store_id,
    changes: { before: { ...(change?.before ?? {}), ...(topicChanged ? { topic_id: item.topic_id } : {}) }, after: update },
  })

  return NextResponse.json({ ok: true, changed: true, item: updated })
}
