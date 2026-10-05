/**
 * PATCH /api/admin/feedback/topics/[id] — 話題を変える（super_admin 専用）
 *
 * **話題の状態・返事・対応の版を変えると、束ねた要望にも写す**（基本設計 §3.5）。
 * 1 件ずつ返事を書かずに済ませるための仕組み。写した要望は updated_at が進み、
 * 拠点の差分取得（§12.3）で現場へ返る。内部メモ・WBS・課題 URL は写さない。
 *
 * - 見送り（declined）は返事が必須（400 reply_required）。
 * - 変更は feedback_events（話題 1 行 + 写した要望ごとに 1 行）と運営アクセスログに残す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'
import { declinedNeedsReply } from '@/lib/feedback/schema'
import { cascadeFields, planCascade, type CascadePatch } from '@/lib/feedback/cascade'
import { SNAPSHOT_COLUMNS, applyItemChanges, recordFeedbackEvents, type FeedbackEventRow, type ItemRow } from '@/lib/feedback/apply'
import { TopicFields } from '@/lib/feedback/topic-schema'

export const dynamic = 'force-dynamic'

const TOPIC_COLUMNS = 'id, title, description, status, reply, fixed_version, wbs_ref, issue_url, internal_note'
type TopicRow = Record<string, unknown> & { id: string; status: string; reply: string | null; fixed_version: string | null }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = TopicFields.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<TopicFields>
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  const svc = createSupabaseService()
  const { data: cur, error: curErr } = await svc.from('feedback_topics').select(TOPIC_COLUMNS).eq('id', id).maybeSingle()
  if (curErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const before = cur as TopicRow
  const merged = { ...before, ...patch } as TopicRow
  if (declinedNeedsReply(merged.status, merged.reply)) {
    return NextResponse.json({ error: 'reply_required' }, { status: 400 })
  }

  // 実際に変わる項目だけ
  const diffKeys = Object.keys(patch).filter((k) => (before[k] ?? null) !== ((patch as Record<string, unknown>)[k] ?? null))
  if (diffKeys.length === 0) return NextResponse.json({ ok: true, changed: false, cascaded: 0 })
  const topicUpdate = Object.fromEntries(diffKeys.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null]))

  const { error: updErr } = await svc.from('feedback_topics').update(topicUpdate).eq('id', id)
  if (updErr) return NextResponse.json({ error: 'update_failed' }, { status: 500 })

  const events: FeedbackEventRow[] = [{
    topic_id: id, actor_user_id: guard.user.id, action: 'topic.update',
    before: Object.fromEntries(diffKeys.map((k) => [k, before[k] ?? null])), after: topicUpdate,
  }]

  // 束ねた要望へ写す。状態を「見送り」にしたときは、返事も一緒に写す（要望側でも返事が必須）。
  const cascade: CascadePatch = cascadeFields(topicUpdate as CascadePatch)
  if (cascade.status === 'declined' && cascade.reply === undefined) cascade.reply = merged.reply
  let cascaded = 0
  if (Object.keys(cascade).length) {
    const { data: items, error: itemsErr } = await svc
      .from('feedback_items').select(SNAPSHOT_COLUMNS).eq('topic_id', id).limit(5000)
    if (itemsErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    const changes = planCascade(cascade, (items ?? []) as ItemRow[])
    if (!(await applyItemChanges(svc, changes))) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    for (const c of changes) {
      events.push({ item_id: c.id, topic_id: id, actor_user_id: guard.user.id, action: 'topic.cascade', before: c.before, after: c.after })
    }
    cascaded = changes.length
  }

  await recordFeedbackEvents(svc, events)
  // 運営アクセスログには内部メモの中身を残さない（項目名だけ）。
  const auditAfter = { ...topicUpdate }
  if ('internal_note' in auditAfter) auditAfter.internal_note = '(変更)'
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'feedback.topic.update',
    targetType: 'feedback_topic',
    targetId: id,
    storeId: null,
    changes: { after: auditAfter, cascaded },
  })

  return NextResponse.json({ ok: true, changed: true, cascaded })
}
