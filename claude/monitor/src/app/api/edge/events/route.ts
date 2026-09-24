/**
 * POST /api/edge/events — nvmsd の重大イベント即時通知（HYBRID_PHASE1_OVERVIEW §4・A2）
 *
 * ノード離脱・録画停止・容量逼迫を、5 分の死活報告を待たず**発生時点で** push する。
 * 「検知・連絡 = Intereco」の分担どおり、運用アラート経路（ALERT_EMAILS / ALERT_WEBHOOK_URL）
 * で即通知し、監査＆一覧のため alarm_events にも記録する（source='nvms'・カメラ非依存）。
 * 案B（死活へのエラー要約同乗）が定期サマリ、A2 が「待たずに上げる割り込み」。
 *
 * 202 = 受領。重複（event_type+node が短時間に連続）はサーバが抑制する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { sendOpsWebhook } from '@/lib/ops/webhook'
import { sendEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

const DEDUP_WINDOW_SEC = 120

const Body = z.object({
  recorderId: z.string().uuid().optional(),
  event_type: z.enum(['node_down', 'recording_stopped', 'disk_low']),
  severity:   z.enum(['critical', 'warning']).default('critical'),
  node:       z.number().int().optional(),
  at:         z.string().optional(),
  // 秘匿値マスク済みの短い本文（案B と同じ約束）。
  message:    z.string().max(500).optional(),
})

const LABEL: Record<string, string> = {
  node_down: 'ノード離脱', recording_stopped: '録画停止', disk_low: '容量逼迫',
}

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { event_type, severity, node, at, message } = parsed.data
  const occurredAt = at ?? new Date().toISOString()
  const dedupKey = `nvms:${event_type}:${node ?? '-'}`

  const svc = createSupabaseService()

  // 重複抑制（同一 store+dedup_key が窓内）。連続する同種イベントで通知を溢れさせない。
  const since = new Date(Date.now() - DEDUP_WINDOW_SEC * 1000).toISOString()
  const { data: dup } = await svc
    .from('alarm_events')
    .select('id')
    .eq('store_id', edge.store_id)
    .eq('dedup_key', dedupKey)
    .gte('occurred_at', since)
    .limit(1)
    .maybeSingle()
  if (dup) return NextResponse.json({ ok: true, deduped: true }, { status: 202 })

  // 監査＆一覧のため記録（source='nvms'・カメラ非依存なので camera_id は null）。
  const { data: ev } = await svc
    .from('alarm_events')
    .insert({
      store_id: edge.store_id, camera_id: null, source: 'nvms',
      event_type, occurred_at: occurredAt, status: 'new', dedup_key: dedupKey,
    })
    .select('id')
    .single()

  // 店舗名・エッジ名（通知本文用・best-effort）。
  const [{ data: st }, { data: ed }] = await Promise.all([
    svc.from('stores').select('name').eq('id', edge.store_id).maybeSingle(),
    svc.from('edge_devices').select('name').eq('id', edge.id).maybeSingle(),
  ])
  const storeName = st?.name ?? '(店舗未設定)'
  const edgeName = ed?.name ?? edge.id

  // 即通知（運用アラート経路・best-effort。失敗しても受領は返す）。
  const text = `【G・VMS ${severity === 'critical' ? '重大' : '警告'}】${storeName} / ${edgeName}`
    + `: ${LABEL[event_type] ?? event_type}`
    + (node != null ? `（node${node}）` : '')
    + (message ? ` — ${message}` : '')
  const recipients = (process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  await Promise.allSettled([
    sendOpsWebhook(text),
    recipients.length ? sendEmail(recipients, text, `<p>${text.replace(/</g, '&lt;')}</p>`) : Promise.resolve(),
  ])
  if (ev) await svc.from('alarm_events').update({ notified_at: new Date().toISOString() }).eq('id', ev.id)

  return NextResponse.json({ ok: true, id: ev?.id ?? null }, { status: 202 })
}
