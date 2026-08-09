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
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordMetric } from '@/lib/metrics'

/**
 * start_live_session() の戻り。**既定値・対象モード・孤児セッションの窓は
 * すべて SQL 側に置いてある**（20260810050000_start_live_session.sql）。
 * ここに定数を再掲すると、両側がずれても誰も気づけない。
 */
interface StartResult {
  session_id:      string | null
  active_count:    number
  limit_max:       number
  session_max_min: number | null
  rejected:        boolean
}

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

    // ── 上限の判定と INSERT（F-10 / R1・live/vod のみ）──────────────────────
    // **判定と作成は DB 関数に 1 トランザクションで任せる。**
    // 旧実装はここで「数える → 入れる」を 2 往復に分けており、
    //   ① 数える側の埋め込み(`stores!inner`)が外部キー不在で常に 400 を返す
    //      → error を捨てていたため count は null → 0 → 上限が一度も発動しない
    //   ② 直したとしても、数えてから入れるまでの隙で同時実行が全員通る
    // の 2 つが同居していた。20260810050000_start_live_session.sql を参照。
    const { data: started, error: startErr } = await supa
      .rpc('start_live_session', {
        p_store_id:  body.storeId,
        p_mode:      body.mode,
        p_camera_id: body.cameraId ?? null,
        p_vod_from:  body.vodFrom ?? null,
        p_vod_to:    body.vodTo ?? null,
      })
      .single<StartResult>()

    // **フェイルクローズ。** 上限の判定ごと失敗しているので通してはいけない
    // （旧実装がここを黙って通していたのが今回の穴そのもの）。
    if (startErr || !started) {
      console.error('[sessions/start] rpc failed:', startErr)
      return NextResponse.json({ error: 'session_start_failed' }, { status: 500 })
    }

    if (started.rejected) {
      await recordMetric({
        kind: 'session_rejected', storeId: body.storeId, userId: user.id,
        value: started.active_count,
        meta: { limit: started.limit_max, mode: body.mode },
      })
      return NextResponse.json(
        { error: 'session_limit_reached', limit: started.limit_max, active: started.active_count },
        { status: 429 },
      )
    }

    // session_max_min は live/vod のみ非 null（grid は上限対象外）。
    return NextResponse.json({ id: started.session_id, maxSessionMin: started.session_max_min })
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
