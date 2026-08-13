/**
 * ユーザ操作からエッジへ送る命令の受け口（視聴の開始・停止のみ）。
 *
 * ⚠ **ここは allowlist。受け取ったボディをそのまま命令にしてはいけない。**
 *
 * 旧実装は `{ ...(body as EdgeCommand) }` とボディを丸ごと展開していた。
 * `EdgeCommand` には **エッジが実際に fetch する URL** を持つ種別がある
 * （`capture_snapshot` / `capture_alarm_timeline` の `ingest_url`、
 * `start_sfu` の `whip_url`）。エッジ側は受け取った URL をそのまま
 * `fetch()` の宛先にするため、**ログイン済みで対象エッジが RLS 上見える
 * だけのユーザが、店舗のカメラ画像を任意の外部宛先へ送り出せた**。
 * `reboot` も同じ条件で通っていた（店舗の監視機材を止められる）。
 *
 * これらは本来この経路を通らない。巡回・発報・BCP・SFU の命令は、サーバ側の
 * 信頼できるコードが service client で `pending_command` を直接書いている
 * （`lib/security/patrol-dispatch.ts` / `lib/alarms/dispatch.ts` /
 *  `api/bcp/*` / `lib/livekit-server.ts`）。**ユーザ経路が必要とするのは
 * 視聴の開始と停止だけ**なので、その 5 種だけを受け付ける。
 *
 * zod の既定は「スキーマに無いキーを落とす」なので、URL 系フィールドは
 * *載っていない時点で* 命令に混ざらない。新しい種別をここに足すときは、
 * **エッジがその値を fetch 先やコマンド引数に使わないか**を必ず確認すること。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { type EdgeCommand } from '@/lib/edge/commands'
import { randomUUID } from 'node:crypto'

/**
 * 日時文字列。`/api/vod` 側が `Date.parse` で受けているのに合わせ、
 * 形式は固定せず「解釈できること」と長さだけを見る
 * （`z.string().datetime()` は既定でオフセット付き `+09:00` を弾くため使わない）。
 */
const IsoLike = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => Number.isFinite(Date.parse(s)), { message: 'unparsable datetime' })

/** ユーザ経路で受理する命令。ここに無いものは 400。 */
const UserCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_grid') }),
  z.object({ action: z.literal('stop_grid') }),
  z.object({ action: z.literal('stop_stream') }),
  z.object({ action: z.literal('start_live'), camera_id: z.string().uuid() }),
  z.object({
    action:    z.literal('start_vod'),
    camera_id: z.string().uuid(),
    clip_id:   z.string().uuid(),
    from_iso:  IsoLike,
    to_iso:    IsoLike,
  }),
])

/** テストと台帳検査から参照する（UI が送る 5 種と一致していること）。 */
export const USER_COMMAND_ACTIONS = [
  'start_grid', 'stop_grid', 'stop_stream', 'start_live', 'start_vod',
] as const

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: edgeId } = await ctx.params

  // Verify caller is authenticated
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: edge, error: edgeErr } = await supa
    .from('edge_devices')
    .select('id, store_id, status')
    .eq('id', edgeId)
    .single()
  if (edgeErr || !edge) return NextResponse.json({ error: 'edge_not_found' }, { status: 404 })

  const parsed = UserCommand.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // 何が違ったかは返さない（受理する種別と必須項目の形が読み取れてしまう）。
    return NextResponse.json({ error: 'invalid_command' }, { status: 400 })
  }

  const command: EdgeCommand = { ...parsed.data, request_id: randomUUID() }

  // Write command to DB — edge agent polls pending_command every 500ms
  const service = createSupabaseService()
  const { error } = await service
    .from('edge_devices')
    .update({
      pending_command:    command,
      pending_command_at: new Date().toISOString(),
    })
    .eq('id', edgeId)

  if (error) {
    // DB のメッセージは返さない（列名・スキーマ状態が漏れる）。切り分けはログで行う。
    console.error('[edge-commands] pending_command update failed', error.message)
    return NextResponse.json({ error: 'command_dispatch_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, request_id: command.request_id })
}
