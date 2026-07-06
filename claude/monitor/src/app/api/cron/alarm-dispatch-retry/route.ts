/**
 * PB7 タイムライン収集の再ディスパッチ cron（是正3）。
 *
 * 発報 ingest 時にエッジの pending_command（巡回/BCP と共有の単一スロット）が埋まっていると
 * capture_alarm_timeline を投入できない。本 cron（vercel.json: 2分毎）が
 * 「timeline_dispatched_at IS NULL かつ 直近30分」の発報を古い順に拾い、スロットが
 * 空き次第再投入する。エッジ側は過ぎたオフセットを録画抽出で埋めるため、数分遅れの
 * ディスパッチでも前後スナップは正しい時刻の絵で揃う。
 *
 * 30分を過ぎた未ディスパッチ分は諦める（録画の取得可能期間・現地対応の実用性を考慮）。
 * 既存の過去データは occurred_at 条件で自然に対象外。
 *
 * 認証: edge-health と同じ CRON_SECRET（Bearer / x-cron-secret）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { dispatchAlarmTimeline } from '@/lib/alarms/dispatch'

export const runtime = 'nodejs'

const RETRY_WINDOW_MIN = 30
const BATCH_LIMIT = 10

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supa = createSupabaseService()
  const since = new Date(Date.now() - RETRY_WINDOW_MIN * 60_000).toISOString()

  const { data: pendings, error } = await supa
    .from('alarm_events')
    .select('id, store_id, occurred_at')
    .is('timeline_dispatched_at', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pendings?.length) return NextResponse.json({ ok: true, pending: 0, dispatched: 0 })

  let dispatched = 0
  // 店舗→エッジは 1:1 運用（複数台でも先頭 1 台に投入すれば全カメラを撮る）。
  for (const ev of pendings) {
    if (!ev.store_id) continue
    const { data: edge } = await supa
      .from('edge_devices')
      .select('id')
      .eq('store_id', ev.store_id)
      .limit(1)
      .maybeSingle()
    if (!edge) continue
    if (await dispatchAlarmTimeline(supa, edge.id, ev.id, ev.occurred_at)) dispatched++
  }

  return NextResponse.json({ ok: true, pending: pendings.length, dispatched })
}
