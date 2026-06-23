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
type Body = StartBody | EndBody

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

    // ── 同時視聴上限の強制（F-10・live/vod のみ）──────────────────────────
    // テナント横断の同時数を正確に数えるため service client(RLSバイパス)で集計。
    // セッションの開始本人は自分のしか見えない(RLS)ので、ここはサーバ権限で数える。
    if (LIMITED_MODES.includes(body.mode)) {
      const svc = createSupabaseService()
      const { data: store } = await svc
        .from('stores').select('tenant_id').eq('id', body.storeId).single()
      const tenantId = (store as { tenant_id?: string } | null)?.tenant_id ?? null
      if (tenantId) {
        const { data: lim } = await svc
          .from('session_limits').select('max_concurrent').eq('tenant_id', tenantId).maybeSingle()
        const max = (lim as { max_concurrent?: number } | null)?.max_concurrent ?? DEFAULT_MAX_CONCURRENT
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
    return NextResponse.json({ id: data.id })
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

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
