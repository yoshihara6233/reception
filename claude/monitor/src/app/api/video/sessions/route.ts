/**
 * POST /api/video/sessions — 遠隔視聴のセッションを開く（GVMS_CLOUD_SPEC §5.1）
 *
 *   { camera_id, kind: 'hls_live' | 'hls_vod', stream?: 'sub' | 'main', from?, to? }
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
 * 同じ人が同じカメラで開いていた前のセッションは止める（再読み込み・画面の開き直しで
 * 拠点の同時視聴の枠を二重に食わないため）。
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { hasCapability } from '@/lib/edge/capabilities'
import { videoR2Configured } from '@/lib/storage/video-r2'
import { ACTIVE_STATES, normalizeVodRange } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

const Body = z.object({
  camera_id: z.string().uuid(),
  kind: z.enum(['hls_live', 'hls_vod']),
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
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { camera_id, kind, stream } = parsed.data

  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('id, recorders ( edge_id, stores: edge_devices ( store_id, agent_version, capabilities ) )')
    .eq('id', camera_id)
    .maybeSingle()
  const c = cam as unknown as CameraRow | null
  const edge = c?.recorders?.stores ?? null
  if (!c?.recorders || !edge) return NextResponse.json({ error: 'camera_not_found' }, { status: 404 })

  if (!hasCapability(edge, kind)) return NextResponse.json({ error: 'not_supported' }, { status: 409 })
  if (!videoR2Configured()) return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 })

  let vod: { from: Date; to: Date } | null = null
  if (kind === 'hls_vod') {
    vod = parsed.data.from ? normalizeVodRange(parsed.data.from, parsed.data.to) : null
    if (!vod) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
  }

  // 現場の視聴記録に残る名前（§5.1 viewer）。表示名が無ければメールの @ より前
  const { data: me } = await supa
    .from('admin_users')
    .select('display_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const profile = me as { display_name: string | null; email: string | null } | null
  const viewerName = (profile?.display_name?.trim()
    || (profile?.email ?? user.email ?? '').split('@')[0]
    || 'クラウド利用者').slice(0, 64)

  const svc = createSupabaseService()
  const nowIso = new Date().toISOString()
  await svc
    .from('video_sessions')
    .update({ stop_requested_at: nowIso })
    .eq('user_id', user.id)
    .eq('camera_id', camera_id)
    .in('state', ACTIVE_STATES as string[])
    .is('stop_requested_at', null)

  const { data: row, error } = await svc
    .from('video_sessions')
    .insert({
      edge_id: c.recorders.edge_id,
      camera_id,
      store_id: edge.store_id,
      user_id: user.id,
      viewer_name: viewerName,
      kind,
      stream: stream ?? 'sub',
      vod_from: vod?.from.toISOString() ?? null,
      vod_to: vod?.to.toISOString() ?? null,
    })
    .select('id')
    .single()
  if (error || !row) {
    console.error('[video/sessions] insert failed:', error?.message)
    return NextResponse.json({ error: 'session_create_failed' }, { status: 500 })
  }
  return NextResponse.json({ id: (row as { id: string }).id }, { status: 201 })
}
