import { NextRequest, NextResponse } from 'next/server'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit, storeIdForRecorder } from '@/lib/admin/audit'
import { alarmPurgeCounts, alarmPurgeFailureBody, purgeRecorderAlarmRecords } from '@/lib/admin/alarm-purge'
import { encryptSecretForEdge } from '@intereco/shared'
import { dbErrorCode } from '@/lib/api/db-error'

const PatchBody = z.object({
  model:      z.string().nullable().optional(),
  // host / username は空にできない（空で上書きすると現地から到達不能になる）。
  host:       z.string().min(1).optional(),
  rtsp_port:  z.coerce.number().int().min(1).max(65535).optional(),
  onvif_port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  username:   z.string().min(1).optional(),
  password:   z.string().optional(),              // 空欄=現状維持。非空のみ更新
  notes:      z.string().nullable().optional(),
  // ライブ/VOD/go2rtc 系（従来は SQL Editor 直編集だったフィールドを UI 化）。
  live_host:    z.string().nullable().optional(),   // Frigate iframe 用 LAN host:port
  vod_host:     z.string().nullable().optional(),   // VOD元 NVR の HTTPS endpoint
  vod_username: z.string().nullable().optional(),
  vod_password: z.string().optional(),              // 空欄=現状維持。非空のみ更新
  vod_channel:  z.coerce.number().int().min(1).max(64).nullable().optional(),
  // Phase 2b（nvms のみ意味を持つ）: BCP 収集方式と対象フォルダ。
  bcp_capture_mode: z.enum(['grid', 'per_camera']).optional(),
  bcp_folder_paths: z.array(z.string().min(1).max(500)).max(200).nullable().optional(),
})

/** 空文字は NULL に正規化（UI でクリア＝NULL にできるように）。 */
const NULLABLE_TEXT = ['model', 'notes', 'live_host', 'vod_host', 'vod_username'] as const

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = PatchBody.safeParse(await req.json())
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, guard.user.id)

  const patch: Record<string, unknown> = { ...parsed.data }
  for (const k of NULLABLE_TEXT) {
    if (patch[k] === '') patch[k] = null
  }
  // Vault化: そのエッジの鍵で暗号化 (enc:v2・エッジごとの鍵)。どのエッジの録画機かを先に引く
  const needsEnc = !!patch.password || (typeof patch.vod_password === 'string' && patch.vod_password !== '')
  let edgeId: string | null = null
  if (needsEnc) {
    const { data: rec } = await guard.supa.from('recorders').select('edge_id').eq('id', id).maybeSingle()
    edgeId = (rec?.edge_id as string | undefined) ?? null
    if (!edgeId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (patch.password) {
    patch.password_enc = encryptSecretForEdge(patch.password as string, edgeId!)
  }
  delete patch.password
  // VOD パスワードは空欄=現状維持。非空のときだけ暗号化して更新。
  if (typeof patch.vod_password === 'string' && patch.vod_password !== '') {
    patch.vod_password_enc = encryptSecretForEdge(patch.vod_password, edgeId!)
  }
  delete patch.vod_password

  const { error } = await guard.supa.from('recorders').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: dbErrorCode(error, '/api/admin/recorders/[id]') }, { status: 500 })

  // 監査ログ（秘密はマスク。変更されたキーのみ記録）。
  const changes: Record<string, unknown> = { ...parsed.data }
  if ('password' in changes) changes.password = '***'
  if ('vod_password' in changes) changes.vod_password = changes.vod_password ? '***' : '(unchanged)'
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'recorder.update',
    targetType: 'recorder',
    targetId: id,
    storeId: await storeIdForRecorder(guard.supa, id),
    changes,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const storeId = await storeIdForRecorder(guard.supa, id)   // 削除前に解決

  // 配下のカメラを参照する発報の記録 (alarm_frames / alarm_events) は ON DELETE の指定が
  // 無く、残っているとレコーダの削除が外部キー違反で止まる。先に消す (lib/admin/alarm-purge.ts)。
  const purge = await purgeRecorderAlarmRecords(guard.supa, id)
  if (!purge.ok) return NextResponse.json(alarmPurgeFailureBody(purge), { status: 500 })

  const { error } = await guard.supa.from('recorders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'delete_failed', message: dbErrorCode(error, '/api/admin/recorders/[id]') }, { status: 500 })
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'recorder.delete',
    targetType: 'recorder',
    targetId: id,
    storeId,
    changes: alarmPurgeCounts(purge),
  })
  return NextResponse.json({ ok: true, deleted: alarmPurgeCounts(purge) })
}
