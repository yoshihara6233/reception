/**
 * POST /api/edge/events — nvmsd の重大イベント即時通知（HYBRID_PHASE1_OVERVIEW §4・A2）
 *
 * ノード離脱・録画停止・容量逼迫を、5 分の死活報告を待たず**発生時点で** push する。
 * 「検知・連絡 = Intereco」の分担どおり、運用アラート経路（ALERT_EMAILS / ALERT_WEBHOOK_URL）
 * で即通知し、監査＆一覧のため alarm_events にも記録する（source='nvms'・カメラ非依存）。
 * 案B（死活へのエラー要約同乗）が定期サマリ、A2 が「待たずに上げる割り込み」。
 *
 * 202 = 受領。重複（event_type+node が短時間に連続）はサーバが抑制する。
 *
 * 復旧（node_up / recording_resumed / disk_ok・severity info）も受ける（G・VMS 提案・
 * 付録A.4 を採用）。復旧は対になる未処理の障害イベントを closed にし、「復旧」として通知する。
 * ディスク故障の兆候 disk_failing（SMART）／回復 disk_healthy も受ける（付録D の提案を採用）。
 * disk_ok（容量の回復）は G・VMS に対応イベントが無く送られない（SMART 回復と混ぜない）。
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
  event_type: z.enum([
    'node_down', 'recording_stopped', 'disk_low', 'disk_failing',
    'node_up', 'recording_resumed', 'disk_ok', 'disk_healthy',
  ]),
  severity:   z.enum(['critical', 'warning', 'info']).default('critical'),
  node:       z.number().int().optional(),
  at:         z.string().optional(),
  // 秘匿値マスク済みの短い本文（案B と同じ約束）。
  message:    z.string().max(500).optional(),
})

const LABEL: Record<string, string> = {
  node_down: 'ノード離脱', recording_stopped: '録画停止', disk_low: '容量逼迫', disk_failing: 'ディスク故障の兆候',
  node_up: 'ノード復帰', recording_resumed: '録画再開', disk_ok: '容量回復', disk_healthy: 'ディスク健康回復',
}

/** 復旧 → 対になる障害。 */
const RECOVERS: Record<string, string> = {
  node_up: 'node_down', recording_resumed: 'recording_stopped', disk_ok: 'disk_low',
  disk_healthy: 'disk_failing',
}

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { event_type, node, at, message } = parsed.data
  const recovers = RECOVERS[event_type] ?? null
  // 復旧は常に info（送り手の severity 指定に依らない）。
  const severity = recovers ? 'info' : parsed.data.severity
  const occurredAt = at ?? new Date().toISOString()
  // 重複抑制キーは severity まで含める。disk_low は warning（満杯が近い）と critical（保護録画まで
  // 消した）が同じ種別で来るため、event_type+node だけだと warning 直後の critical を握り潰す。
  const nodeKey = node ?? '-'
  const dedupKey = `nvms:${event_type}:${nodeKey}:${severity}`

  const svc = createSupabaseService()

  // 復旧: 対になる未処理の障害イベントを閉じる（一覧に「落ちたまま」が残らないように）。
  if (recovers) {
    await svc.from('alarm_events')
      .update({ status: 'closed' })
      .eq('store_id', edge.store_id)
      .in('dedup_key', [`nvms:${recovers}:${nodeKey}:critical`, `nvms:${recovers}:${nodeKey}:warning`])
      .eq('status', 'new')
  }

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
      event_type, occurred_at: occurredAt, status: recovers ? 'closed' : 'new', dedup_key: dedupKey,
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
  const tag = severity === 'critical' ? '重大' : severity === 'warning' ? '警告' : '復旧'
  const text = `【G・VMS ${tag}】${storeName} / ${edgeName}`
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
