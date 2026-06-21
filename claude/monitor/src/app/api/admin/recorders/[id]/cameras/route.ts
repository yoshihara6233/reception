/**
 * Bulk upsert + delete for a recorder's cameras.
 * Body shape:
 *   { upsert: Camera[], delete: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'

const Camera = z.object({
  id:             z.string().uuid().optional(),
  channel:        z.coerce.number().int().min(1).max(64),
  name:           z.string().min(1),
  grid_pos:       z.coerce.number().int().min(0).max(15),
  enabled:        z.boolean().default(true),
  frigate_camera: z.string().nullable().optional(),
  // go2rtc 高画質ライブ系（従来は SQL Editor 直編集）。空文字は NULL 化。
  hls_url:        z.string().nullable().optional(),   // go2rtc stream URL 上書き
  live_rtsp:      z.string().nullable().optional(),   // go2rtc 自動登録用 RTSP ソース
})

const Body = z.object({
  upsert: z.array(Camera).default([]),
  delete: z.array(z.string().uuid()).default([]),
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id: recorderId } = await ctx.params
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const { upsert, delete: toDelete } = parsed.data

  // Delete first so users can recycle channel numbers in the same save.
  if (toDelete.length) {
    const { error } = await guard.supa
      .from('recorder_cameras')
      .delete()
      .eq('recorder_id', recorderId)
      .in('id', toDelete)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (upsert.length) {
    const rows = upsert.map((c) => ({
      ...(c.id ? { id: c.id } : {}),   // 新規カメラは id を省略 → DB が gen_random_uuid() で生成
      recorder_id:    recorderId,
      channel:        c.channel,
      name:           c.name,
      grid_pos:       c.grid_pos,
      enabled:        c.enabled,
      frigate_camera: c.frigate_camera ?? null,
      hls_url:        c.hls_url?.trim() || null,
      live_rtsp:      c.live_rtsp?.trim() || null,
    }))
    const { error } = await guard.supa
      .from('recorder_cameras')
      .upsert(rows, { onConflict: 'recorder_id,channel' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, upserted: upsert.length, deleted: toDelete.length })
}
