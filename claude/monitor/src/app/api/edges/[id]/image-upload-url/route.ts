/**
 * POST /api/edges/[id]/image-upload-url — エッジ向け ライブ画像アップロード先の発行
 *
 * grid.jpg / snapshot.jpg を Supabase Storage ではなく R2 へ上げさせるための
 * presigned PUT を返す（背景は lib/storage/edge-images-r2.ts のコメント）。
 * R2 未設定なら mode:'supabase' を返し、エッジは従来経路のまま＝env 設定だけで
 * 切り替わり、デプロイと OTA の順序に依存しない。
 *
 * 認証: Authorization: Bearer <device_token>（clip-upload と同形）。
 * 発行するキーは自エッジの決定的パスのみ＝トークンを持っていても他エッジや
 * 任意キーへは書けない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  edgeImagesR2Configured, presignEdgeImagePut, gridKey, snapshotKey,
} from '@/lib/storage/edge-images-r2'

const Body = z.object({
  // 省略時は grid のみ。カメラ ID を渡すとその分の snapshot URL も返す。
  cameraIds: z.array(z.string().uuid()).max(64).optional(),
})

/** presign の TTL。エッジはこの期限まで同じ URL を使い回す。 */
const TTL_SEC = 3600

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: edgeId } = await ctx.params

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: edge } = await svc
    .from('edge_devices')
    .select('id')
    .eq('device_token', token)
    .maybeSingle()
  // 自分自身の分しか発行しない（他エッジのキーを要求しても弾く）。
  if (!edge || edge.id !== edgeId) {
    return NextResponse.json({ error: 'invalid device token' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const cameraIds = parsed.data.cameraIds ?? []

  if (!edgeImagesR2Configured()) return NextResponse.json({ mode: 'supabase' })

  try {
    const expiresAt = Date.now() + TTL_SEC * 1000
    const grid = await presignEdgeImagePut(gridKey(edgeId), TTL_SEC)
    const snapshots: Record<string, string> = {}
    for (const camId of cameraIds) {
      snapshots[camId] = await presignEdgeImagePut(snapshotKey(edgeId, camId), TTL_SEC)
    }
    return NextResponse.json({ mode: 'r2', expiresAt, grid, snapshots })
  } catch (e) {
    // presign 失敗で映像を止めない（エッジは Supabase フォールバック）。
    console.error('[edges image-upload-url] presign failed → supabase fallback', String(e))
    return NextResponse.json({ mode: 'supabase' })
  }
}
