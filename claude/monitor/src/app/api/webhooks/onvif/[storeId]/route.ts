/**
 * F49.K: ONVIF Event Webhook 受信エンドポイント
 *
 * NVR からの ONVIF Notification を受信 (PullPoint / Push) し、
 * 標準化された NvrEvent としてキューに登録、edge-agent (中央モード) が
 * 後続処理する。
 *
 * URL: POST /api/webhooks/onvif/[storeId]
 *
 * 認証: 共有 secret を Authorization ヘッダで照合 (Phase 2)
 *   ONVIF_WEBHOOK_SECRET 環境変数または stores.nvr_options.webhook_secret
 *
 * 受信ペイロード (ONVIF SOAP の簡略 JSON 化):
 *   {
 *     topic:    "tns1:VideoSource/MotionAlarm",
 *     source:   { channel: 1, camera_id: "ch01" },
 *     value:    { state: true },
 *     occurred_at: "2026-06-04T10:30:00Z"
 *   }
 *
 * 動作:
 *   1. 共有 secret を検証
 *   2. topic を NvrEventType に正規化 (motion / video_loss / tampering / ai_*)
 *   3. monitor_incidents に INSERT (または bcp_events トリガ用 onvif_events に書込)
 *   4. central_node にプッシュ通知 (Phase 3 で Supabase Realtime 経由)
 *
 * 実 NVR を繋ぐまでは mock リクエストで挙動確認可能。
 */
import { NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'

interface OnvifEventPayload {
  topic:       string
  source?:     { channel?: number; camera_id?: string }
  value?:      Record<string, unknown>
  occurred_at?: string
}

// ONVIF topic → 内部 event type マッピング
const TOPIC_MAP: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /motion/i,        type: 'motion' },
  { pattern: /videoloss/i,     type: 'video_loss' },
  { pattern: /tampering|tamper/i, type: 'tampering' },
  { pattern: /audio.*anomaly/i,type: 'audio_anomaly' },
  { pattern: /person/i,        type: 'ai_person' },
  { pattern: /vehicle/i,       type: 'ai_vehicle' },
]

function normalizeTopic(topic: string): string {
  for (const { pattern, type } of TOPIC_MAP) {
    if (pattern.test(topic)) return type
  }
  return 'unknown'
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params

  // ── 1. 認証 ──
  const auth = req.headers.get('authorization') ?? ''
  const expectedSecret = process.env.ONVIF_WEBHOOK_SECRET
  if (expectedSecret) {
    const provided = auth.replace(/^Bearer\s+/i, '')
    if (provided !== expectedSecret) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── 2. ペイロードパース ──
  let body: OnvifEventPayload
  try {
    body = await req.json() as OnvifEventPayload
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.topic) {
    return NextResponse.json({ ok: false, message: 'topic is required' }, { status: 400 })
  }

  const type        = normalizeTopic(body.topic)
  const channel     = body.source?.channel ?? null
  const occurredAt  = body.occurred_at ?? new Date().toISOString()

  // ── 3. 店舗の存在確認 (service_role 経由) ──
  // store_id バリデーション: 認可は webhook_secret に委ねる前提なので、
  // 店舗の存在だけ確認
  const supa = createSupabaseService()
  const { data: store } = await supa
    .from('stores')
    .select('id, deployment_mode, tenant_id')
    .eq('id', storeId)
    .maybeSingle()
  if (!store) {
    return NextResponse.json({ ok: false, message: 'store not found' }, { status: 404 })
  }

  // ── 4. monitor_incidents へ INSERT (重要イベントのみ) ──
  if (type === 'video_loss' || type === 'tampering') {
    // 既存スキーマ準拠: monitor_incidents は (store_id, target_type, kind, severity, status)
    try {
      await supa.from('monitor_incidents').insert({
        store_id:     storeId,
        target_type:  'camera',
        target_id:    channel ? String(channel) : null,
        kind:         type,
        severity:     type === 'video_loss' ? 'danger' : 'warn',
        status:       'open',
        detail:       body.value ? JSON.stringify(body.value) : null,
        detected_at:  occurredAt,
      })
    } catch (err) {
      // 既存スキーマと不一致な場合があるので警告止まり
      console.warn('monitor_incidents insert failed (skipping):', (err as Error).message)
    }
  }

  // ── 5. 全イベントを audit ログ的に記録 (任意テーブル) ──
  // Phase 2 で onvif_events テーブルを追加予定。現状はログのみ。
  // ※ ペイロードは store_id, type, channel, topic, value, occurred_at を含むので
  //   将来テーブル設計が固まったらここで INSERT

  return NextResponse.json({
    ok:            true,
    storeId,
    type,
    channel,
    topic:         body.topic,
    occurredAt,
    note:          'Phase 2: ack only. Full event persistence is Phase 3 work.',
  })
}

/**
 * GET でヘルスチェック (NVR が webhook 設定時の疎通確認用)
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params
  return NextResponse.json({
    ok:       true,
    storeId,
    accepts:  'POST application/json',
    schema:   {
      topic:       'string (required, e.g. "tns1:VideoSource/MotionAlarm")',
      source:      { channel: 'int', camera_id: 'string' },
      value:       'object (vendor-specific)',
      occurred_at: 'ISO 8601 (optional)',
    },
    auth:     process.env.ONVIF_WEBHOOK_SECRET ? 'Bearer token required' : 'open (no secret set)',
  })
}
