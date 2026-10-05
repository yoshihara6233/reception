/**
 * POST /api/admin/feedback/topics — 話題を作る（super_admin 専用）
 *
 * item_ids を渡すと、その要望をこの話題に束ねる（要望は話題の状態を受け継ぐ）。
 * 話題は運営だけが読む（内部メモ・WBS・課題 URL をテナントへ出さない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'
import { declinedNeedsReply } from '@/lib/feedback/schema'
import { inheritFromTopic, planCascade } from '@/lib/feedback/cascade'
import { SNAPSHOT_COLUMNS, applyItemChanges, recordFeedbackEvents, type FeedbackEventRow, type ItemRow } from '@/lib/feedback/apply'
import { TopicFields } from '@/lib/feedback/topic-schema'

export const dynamic = 'force-dynamic'

const Body = TopicFields.extend({
  title: z.string().trim().min(1).max(200),
  item_ids: z.array(z.string().uuid()).max(500).optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { item_ids, ...fields } = parsed.data
  const status = fields.status ?? 'reviewing'
  if (declinedNeedsReply(status, fields.reply ?? null)) {
    return NextResponse.json({ error: 'reply_required' }, { status: 400 })
  }

  const svc = createSupabaseService()
  const { data: topic, error } = await svc
    .from('feedback_topics')
    .insert({ ...fields, status, created_by: guard.user.id })
    .select('id, title, status, reply, fixed_version')
    .single()
  if (error || !topic) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  const t = topic as { id: string; title: string; status: string; reply: string | null; fixed_version: string | null }

  const events: FeedbackEventRow[] = [{ topic_id: t.id, actor_user_id: guard.user.id, action: 'topic.create', after: { ...fields, status } }]

  let bundled = 0
  if (item_ids?.length) {
    const { data: items, error: itemsErr } = await svc
      .from('feedback_items').select(SNAPSHOT_COLUMNS).in('id', item_ids)
    if (itemsErr) return NextResponse.json({ error: 'lookup_failed', topic_id: t.id }, { status: 500 })
    const rows = (items ?? []) as ItemRow[]
    if (rows.length) {
      const { error: bundleErr } = await svc
        .from('feedback_items').update({ topic_id: t.id }).in('id', rows.map((r) => r.id))
      if (bundleErr) return NextResponse.json({ error: 'update_failed', topic_id: t.id }, { status: 500 })
      const changes = planCascade(inheritFromTopic(t), rows)
      if (!(await applyItemChanges(svc, changes))) {
        return NextResponse.json({ error: 'update_failed', topic_id: t.id }, { status: 500 })
      }
      const byId = new Map(changes.map((c) => [c.id, c]))
      for (const r of rows) {
        const c = byId.get(r.id)
        events.push({
          item_id: r.id, topic_id: t.id, actor_user_id: guard.user.id, action: 'item.bundle',
          before: { topic_id: r.topic_id, ...(c?.before ?? {}) }, after: { topic_id: t.id, ...(c?.after ?? {}) },
        })
      }
      bundled = rows.length
    }
  }

  await recordFeedbackEvents(svc, events)
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'feedback.topic.create',
    targetType: 'feedback_topic',
    targetId: t.id,
    storeId: null,
    changes: { title: t.title, status, bundled },
  })

  return NextResponse.json({ ok: true, id: t.id, bundled }, { status: 201 })
}
