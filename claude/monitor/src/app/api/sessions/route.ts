/**
 * /api/sessions — 操作監査ログ (live_sessions) の書き込み
 *
 * F23: 監査ログテーブル live_sessions に書き込むコードがどこにも無く、
 * 結果として /admin/audit が常に空だった問題を解消。
 *
 * POST { action: 'start', mode, storeId, cameraId? }
 *   → INSERT live_sessions row (user_id = auth.uid())
 *   → returns { id }
 *
 * POST { action: 'end', id }
 *   → UPDATE ended_at = now(), duration_sec = computed
 *
 * RLS:
 *   - sessions_insert: WITH CHECK (user_id = auth.uid())
 *   - sessions_select: 自分のセッション OR tenant_admin/super_admin
 *     (UPDATE は INSERT した本人が auth.uid() でアクセスする限り通る)
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordMetric } from '@/lib/metrics'

// 同時視聴上限（F-10）。session_limits.max_concurrent 未設定時の既定。
const DEFAULT_MAX_CONCURRENT = 5
// R1: 1視聴セッションの最大継続分数。session_limits.max_session_min 未設定時の既定。
const DEFAULT_MAX_SESSION_MIN = 120
// これより古い未終了セッションは「閉じ忘れ(孤児)」とみなしカウント外（恒久ロックアウト防止）。
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000
// 上限の対象は帯域コストの高い live / vod のみ。grid(スナップ合成)は安価なので対象外。
const LIMITED_MODES = ['live', 'vod']

interface StartBody {
  action:    'start'
  mode:      'grid' | 'live' | 'vod'
  storeId:   string
  cameraId?: string | null
  vodFrom?:  string | null
  vodTo?:    string | null
}
interface EndBody {
  action: 'end'
  id:     string
}
/**
 * S4: SFU 視聴のマーキング。SFU モードに入った時点で livekit_room を記録し、
 * /infra/slo の egress 概算（SFU session-分）の母数にする。room 名はクライアント値を
 * 信用せず、行の camera_id から**サーバが導出**する（roomForCamera と同規則）。
 */
interface MarkSfuBody {
  action: 'mark_sfu'
  id:     string
}
type Body = StartBody | EndBody | MarkSfuBody

export async function POST(req: Request) {
  const supa = await createSupabaseServer()
  const { data: { user }, error: authErr } = await supa.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (body.action === 'start') {
    if (!body.mode || !body.storeId) {
      return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
    }

    // 店舗の可視性を RLS に確認させる（stores_select）。
    // 旧実装は storeId を無検証で受けており、他テナントの店舗IDを渡すと
    // その行が作れた。映像自体は別経路で守られているので開示にはならないが、
    // **他テナントの同時視聴枠を消費できた**（下の集計はテナント単位で数える）。
    const { data: visibleStore } = await supa
      .from('stores')
      .select('id')
      .eq('id', body.storeId)
      .maybeSingle()
    if (!visibleStore) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    // ── 上限の解決＋同時視聴上限の強制（F-10 / R1・live/vod のみ）───────────
    // テナント横断の同時数を正確に数えるため service client(RLSバイパス)で集計。
    // セッションの開始本人は自分のしか見えない(RLS)ので、ここはサーバ権限で数える。
    // あわせて max_session_min（1セッションの最大継続分数）を解決し、クライアントに返す。
    let maxSessionMin: number | null = null
    if (LIMITED_MODES.includes(body.mode)) {
      maxSessionMin = DEFAULT_MAX_SESSION_MIN
      const svc = createSupabaseService()
      const { data: store } = await svc
        .from('stores').select('tenant_id').eq('id', body.storeId).single()
      const tenantId = (store as { tenant_id?: string } | null)?.tenant_id ?? null
      if (tenantId) {
        const { data: lim } = await svc
          .from('session_limits')
          .select('max_concurrent, max_session_min')
          .eq('tenant_id', tenantId)
          .maybeSingle()
        const limit = lim as { max_concurrent?: number; max_session_min?: number } | null
        const max = limit?.max_concurrent ?? DEFAULT_MAX_CONCURRENT
        maxSessionMin = limit?.max_session_min ?? DEFAULT_MAX_SESSION_MIN
        const sinceIso = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString()
        const { count } = await svc
          .from('live_sessions')
          .select('id, stores!inner(tenant_id)', { count: 'exact', head: true })
          .is('ended_at', null)
          .gte('started_at', sinceIso)
          .in('mode', LIMITED_MODES)
          .eq('stores.tenant_id', tenantId)
        const active = count ?? 0
        if (active >= max) {
          await recordMetric({
            kind: 'session_rejected', storeId: body.storeId, userId: user.id,
            value: active, meta: { limit: max, mode: body.mode },
          })
          return NextResponse.json(
            { error: 'session_limit_reached', limit: max, active }, { status: 429 },
          )
        }
      }
    }

    const { data, error } = await supa
      .from('live_sessions')
      .insert({
        user_id:    user.id,
        store_id:   body.storeId,
        camera_id:  body.cameraId ?? null,
        mode:       body.mode,
        started_at: new Date().toISOString(),
        vod_from:   body.vodFrom ?? null,
        vod_to:     body.vodTo ?? null,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[sessions/start] insert failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // maxSessionMin は live/vod のみ非 null（grid は上限対象外）。
    return NextResponse.json({ id: data.id, maxSessionMin })
  }

  if (body.action === 'end') {
    if (!body.id) {
      return NextResponse.json({ error: 'missing_id' }, { status: 400 })
    }
    // Read started_at to compute duration_sec
    const { data: row, error: readErr } = await supa
      .from('live_sessions')
      .select('started_at')
      .eq('id', body.id)
      .single()
    if (readErr || !row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const startedMs = new Date(row.started_at).getTime()
    const endedAt   = new Date()
    const duration  = Math.max(0, Math.round((endedAt.getTime() - startedMs) / 1000))
    const { error } = await supa
      .from('live_sessions')
      .update({
        ended_at:     endedAt.toISOString(),
        duration_sec: duration,
      })
      .eq('id', body.id)
    if (error) {
      console.error('[sessions/end] update failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, duration_sec: duration })
  }

  if (body.action === 'mark_sfu') {
    if (!body.id) {
      return NextResponse.json({ error: 'missing_id' }, { status: 400 })
    }
    // RLS セッションクライアント: 自分のセッション行しか読めない/更新できない
    // （sessions_select / sessions_update とも user_id = auth.uid()）。
    const { data: row, error: readErr } = await supa
      .from('live_sessions')
      .select('camera_id')
      .eq('id', body.id)
      .single()
    if (readErr || !row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const cameraId = (row as { camera_id: string | null }).camera_id
    if (!cameraId) {
      return NextResponse.json({ error: 'no_camera' }, { status: 400 })
    }
    const { error } = await supa
      .from('live_sessions')
      .update({ livekit_room: `cam_${cameraId}` })
      .eq('id', body.id)
    if (error) {
      console.error('[sessions/mark_sfu] update failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
