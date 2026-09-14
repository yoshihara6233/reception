/**
 * POST /api/edge/nvms-sync — NVMS のカメラ・フォルダをクラウドへ同期する
 *
 * 正は NVMS。エッジが NVMS の /cameras と /camera-folders を読み、
 * このエンドポイントへスナップショットを送る（起動時＋10分ごと、
 * edge-agent/src/workers/nvms-sync.ts）。手で 1 台ずつ登録しない —
 * 10万台構成で人手登録は成立しないため、登録は「NVMS レコーダを 1 行
 * 作る」だけで、カメラは全部ここから流れ込む。
 *
 * 同期の約束事:
 *   - channel = NVMS のカメラ ID（Phase 1 の規約どおり）
 *   - 突き合わせは (recorder_id, channel) の UNIQUE
 *   - スナップショットに無くなったカメラは enabled=false（消さない。
 *     録画クリップ・BCP イベントが camera_id を参照しているため）
 *   - grid_pos: 新規は空きスロット 0..15 を先着で埋め、以降は -1
 *     （フォルダページ表示が主。固定スロットは互換のためだけに残す）
 *   - 1 リクエスト最大 500 台。エッジ側が分割して送る
 *
 * 認証: Authorization: Bearer <device_token>。**レコーダの所有検査つき** —
 * トークンが正しくても、他エッジ配下や nvms 以外のレコーダへは書けない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { planCameraRows, computeGoneIds } from '@/lib/edge/nvms-sync-plan'

export const dynamic = 'force-dynamic'

const CameraIn = z.object({
  id:          z.number().int().min(1),          // NVMS のカメラ ID → channel
  name:        z.string().min(1).max(200),
  folder_path: z.string().max(500).nullable(),
  enabled:     z.boolean(),
})

const Body = z.object({
  recorderId: z.string().uuid(),
  /** この chunk が最終なら true — 送られてこなかったカメラの無効化はこの時だけ行う。 */
  final:      z.boolean(),
  /** スナップショット全体で NVMS 側に存在するカメラ ID（final の無効化判定用）。 */
  presentIds: z.array(z.number().int().min(1)).max(200_000),
  cameras:    z.array(CameraIn).max(500),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { recorderId, final, presentIds, cameras } = parsed.data

  const svc = createSupabaseService()

  // 所有検査: このエッジ配下の nvms レコーダであること。
  const { data: rec } = await svc
    .from('recorders')
    .select('id, vendor, edge_id')
    .eq('id', recorderId)
    .maybeSingle()
  if (!rec || rec.edge_id !== edge.id) {
    return NextResponse.json({ error: 'recorder not owned by this edge' }, { status: 403 })
  }
  if (rec.vendor !== 'nvms') {
    return NextResponse.json({ error: 'recorder is not nvms' }, { status: 422 })
  }

  // 既存カメラ（channel→id, grid_pos）を一括で引く。10万台でも列2本なので軽い。
  const { data: existing, error: exErr } = await svc
    .from('recorder_cameras')
    .select('id, channel, grid_pos')
    .eq('recorder_id', recorderId)
    .limit(200_000)
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  const existingCams = (existing ?? []).map((c) => ({
    id: c.id as string, channel: c.channel as number, grid_pos: c.grid_pos as number,
  }))
  // 割付ロジックは nvms-sync-plan.ts（純粋関数・テスト付き）。
  const rows = planCameraRows(recorderId, existingCams, cameras)

  let upserted = 0
  if (rows.length > 0) {
    const { error } = await svc
      .from('recorder_cameras')
      .upsert(rows, { onConflict: 'recorder_id,channel' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    upserted = rows.length
  }

  // final chunk: NVMS 側から消えたカメラを無効化（削除はしない）。
  let disabled = 0
  if (final) {
    const gone = computeGoneIds(existingCams, presentIds)
    if (gone.length > 0) {
      const { error } = await svc
        .from('recorder_cameras')
        .update({ enabled: false })
        .in('id', gone)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      disabled = gone.length
    }
  }

  return NextResponse.json({ ok: true, upserted, disabled })
}
