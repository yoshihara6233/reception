/**
 * POST /api/video/sessions — 遠隔視聴のセッションを開く（GVMS_CLOUD_SPEC §5.1）
 *
 *   { camera_id, kind: 'hls_live' | 'hls_vod' | 'sfu', stream?: 'sub' | 'main', from?, to? }
 *   → 201 { id }
 *
 * ここでは video_sessions に 1 行置くだけ。拠点への開始の指示は、拠点が次に
 * commands/next を取りに来たときに組み立てて渡す（lib/video/dispatch.ts）。
 *
 * 認可の順番（rls-gate-before-service の契約）:
 *   1. ログイン
 *   2. **RLS 配下で**カメラが見えるか（recorder_cameras → recorders → edge_devices）
 *   3. 拠点がその機能を名乗っているか（名乗りに無い操作は受けない・§2）
 *   4. ここで初めて service role で行を作る
 *
 * 同時視聴の上限はここでも確かめる（open_video_session・上限なら 429 session_limit_reached）。
 * 同じ人が同じカメラで開いていた前のセッションは止める（再読み込み・画面の開き直しで
 * 拠点の同時視聴の枠を二重に食わないため）。
 */
import { NextResponse } from 'next/server'
import { recordMetric } from '@/lib/metrics'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { hasCapability } from '@/lib/edge/capabilities'
import { videoR2Configured } from '@/lib/storage/video-r2'
import { gvmsSfuEnabled } from '@/lib/livekit'
import { normalizeVodRange } from '@/lib/video/session-logic'
import { heavyAllows, tooManyRequests } from '@/lib/limits/heavy'

export const dynamic = 'force-dynamic'

const Body = z.object({
  camera_id: z.string().uuid(),
  kind: z.enum(['hls_live', 'hls_vod', 'sfu']),
  stream: z.enum(['sub', 'main']).optional(),
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
})

interface CameraRow {
  id: string
  recorders: {
    edge_id: string
    stores: { store_id: string; agent_version: string | null; capabilities: string[] | null } | null
  } | null
}

export async function POST(req: Request) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, user.id)
  const { camera_id, kind, stream } = parsed.data

  // カメラの可視性（RLS）と表示名は互いに依らないので並べて引く（見始めの待ちを 1 往復減らす）。
  // どちらもセッションクライアント（RLS 配下）で、service role はカメラが見えてから組み立てる
  const [{ data: cam }, { data: me }] = await Promise.all([
    supa
      .from('recorder_cameras')
      .select('id, recorders ( edge_id, stores: edge_devices ( store_id, agent_version, capabilities ) )')
      .eq('id', camera_id)
      .maybeSingle(),
    supa
      .from('admin_users')
      .select('display_name, email')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
  ])
  const c = cam as unknown as CameraRow | null
  const edge = c?.recorders?.stores ?? null
  if (!c?.recorders || !edge) return NextResponse.json({ error: 'camera_not_found' }, { status: 404 })

  if (!hasCapability(edge, kind)) return NextResponse.json({ error: 'not_supported' }, { status: 409 })
  // HLS は置き場（R2）、SFU は LiveKit が要る。無ければ始めても映らないので受けない。
  // SFU は 2026-09-29 から保留（gvmsSfuEnabled・既定 OFF）。画面に出さないだけでなくここでも断る
  if (kind === 'sfu' ? !gvmsSfuEnabled() : !videoR2Configured()) {
    return NextResponse.json({ error: kind === 'sfu' ? 'sfu_unavailable' : 'storage_unavailable' }, { status: 503 })
  }

  let vod: { from: Date; to: Date } | null = null
  if (kind === 'hls_vod') {
    vod = parsed.data.from ? normalizeVodRange(parsed.data.from, parsed.data.to) : null
    if (!vod) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
  }

  // 現場の視聴記録に残る名前（§5.1 viewer）。表示名が無ければメールの @ より前
  const profile = me as { display_name: string | null; email: string | null } | null
  const viewerName = (profile?.display_name?.trim()
    || (profile?.email ?? user.email ?? '').split('@')[0]
    || 'クラウド利用者').slice(0, 64)

  const svc = createSupabaseService()

  // 回数の上限（60 秒 30 回・1 時間 600 回・自主診断 ASVS 2.4.1）。同時に見られる本数は
  // 別にテナントの同時視聴数（session_limits）が縛る。ここは開き直しの連打を止める
  const allowed = await heavyAllows(svc, 'video-session', { user: user.id })
  if (!allowed.ok) return tooManyRequests(allowed.retryAfterSec)

  // 前のセッションを止める・同時視聴の上限を確かめる・行を作るまでを DB で 1 トランザクションで行う
  // (2026-10-31・発注者の判断 A・20261031120000_viewing_limit_server.sql)。上限の判定に失敗したら通さない
  const { data: opened, error } = await svc
    .rpc('open_video_session', {
      p_user: user.id,
      p_store_id: edge.store_id,
      p_edge_id: c.recorders.edge_id,
      p_camera_id: camera_id,
      p_viewer_name: viewerName,
      p_kind: kind,
      p_stream: stream ?? 'sub',
      p_vod_from: vod?.from.toISOString() ?? null,
      p_vod_to: vod?.to.toISOString() ?? null,
    })
    .single<{ session_id: string | null; active_count: number; limit_max: number; rejected: boolean }>()
  if (error || !opened) {
    console.error('[video/sessions] open failed:', error?.message)
    return NextResponse.json({ error: 'session_create_failed' }, { status: 500 })
  }
  if (opened.rejected || !opened.session_id) {
    await recordMetric({
      kind: 'session_rejected', storeId: edge.store_id, userId: user.id,
      value: opened.active_count, meta: { limit: opened.limit_max, mode: kind },
    })
    return NextResponse.json(
      { error: 'session_limit_reached', limit: opened.limit_max, active: opened.active_count },
      { status: 429 },
    )
  }
  return NextResponse.json({ id: opened.session_id }, { status: 201 })
}
