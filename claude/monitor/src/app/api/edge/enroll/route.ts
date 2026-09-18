/**
 * エッジ自己登録 redeem（公開・トークン認証）。
 *
 * 現地ユニットが QR/トークンを読み取り `{ token }` を POST。サーバはトークンを検証して
 * **エッジ行を作成し device_token を払い出す**。エッジは以降この device_token で
 * heartbeat / bootstrap(鍵取得) を行う。
 *
 * 硬化（spec TC4）:
 *  - 単一使用: used_at を**原子的にクレーム**（同時/再 POST で二重登録しない）。
 *  - used_at は**成功時のみ**刻印（途中失敗ではエッジ行をロールバックし焼かない）。
 *  - tenant/store はトークン行由来（クライアントは store_id を送れない＝詐称不可）。
 *  - 生トークンは保存せず hash 照合。失効/使用済/不一致は 403。
 *  - RLS バイパスの service client を使う（公開エンドポイントのため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { encryptSecret } from '@intereco/shared'
import { createSupabaseService } from '@/lib/supabase/server'
import { hashEnrollToken, hashShortCode } from '@/lib/admin/enrollment'
import { clientIp, rateLimitAllows } from '@/lib/rate-limit'
import { hashDeviceToken } from '@/lib/edge/device-token'

// QR は 64hex トークン、手入力は短縮コード（例 A7K3Q-2F9MZ）。どちらでも受ける。
// 短縮コードは十数文字なので 8 文字から通す。
const Body = z.object({
  token: z.string().min(8).max(256).optional(),
  code:  z.string().min(8).max(256).optional(),
}).refine((b) => b.token || b.code, 'token or code required')

/**
 * IP あたりの試行上限。
 *
 * トークン自体は 32 バイト乱数のハッシュ照合なので総当たりは通らない。
 * ここで防ぎたいのは**総当たりの成功**ではなく、公開受け口へ大量に投げて
 * DB を引かせる形の負荷。現地でユニットを並べて登録する作業を邪魔しない
 * 程度に緩く取る（1 拠点で数台〜十数台）。
 */
const ENROLL_MAX_PER_IP = 30
const ENROLL_WINDOW_SEC = 60 * 60

export async function POST(req: NextRequest) {
  const svc = createSupabaseService()

  // 本文を読む前に絞る（JSON 解析も DB 参照もさせない）。
  const ip = clientIp(req)
  if (ip) {
    const ok = await rateLimitAllows(svc, `enroll:ip:${ip}`, ENROLL_MAX_PER_IP, ENROLL_WINDOW_SEC)
    if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const nowIso = new Date().toISOString()

  // 1) 事前検証（未使用・未失効）。QR の 64hex は token_hash、手入力の短縮コードは
  //    short_code_hash で引く。まず token_hash、無ければ short_code_hash の 2 段引き
  //    （どちらも同じ行に解決する）。不正は行を作らず 403。
  const raw = parsed.data.token ?? parsed.data.code ?? ''
  const cols = ['token_hash', hashEnrollToken(raw)] as const
  const lookup = (col: string, hash: string) => svc
    .from('enrollment_tokens')
    .select('id, kind, store_id, name, camera_tier, used_at, expires_at')
    .eq(col, hash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle()

  let tok = (await lookup(cols[0], cols[1])).data
  if (!tok) tok = (await lookup('short_code_hash', hashShortCode(raw))).data
  if (!tok) return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 403 })

  // 2) エッジ行を作成（device_token 払出）。store/name/tier はトークン由来。
  const device_token = randomBytes(32).toString('hex')
  const { data: edge, error: edgeErr } = await svc
    .from('edge_devices')
    .insert({
      store_id:    tok.store_id,
      name:        tok.name,
      // DB にはハッシュだけ。平文は 4) の払出レスポンスが唯一の出口。
      device_token_hash: hashDeviceToken(device_token),
      status:      'offline',
      camera_tier: tok.camera_tier,
    })
    .select('id')
    .single()
  if (edgeErr || !edge) return NextResponse.json({ error: 'enroll_failed' }, { status: 500 })

  // 3) 原子的クレーム: used_at IS NULL の時だけ used_at + edge_id をセット。
  //    競合で既に使われていたら 0 行 → 作成したエッジ行をロールバックして 403。
  const { data: claimed } = await svc
    .from('enrollment_tokens')
    .update({ used_at: nowIso, edge_id: edge.id })
    .eq('id', tok.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    await svc.from('edge_devices').delete().eq('id', edge.id)   // ロールバック（焼かない）
    return NextResponse.json({ error: 'token_already_used' }, { status: 403 })
  }

  // 3.5) nvms は vendor='nvms' のレコーダも自動作成（ENROLLMENT_SPEC §3）。
  //   nvms-sync/グリッド/BCP は事前レコーダを要する。アップリンク型では
  //   クラウドはレコーダに接続しに行かない（nvmsd が押し出す）ため、
  //   host/username/password は表示用の暫定値でよい。nvmsd は recorder_id を
  //   GET /api/edge/recorders で学ぶ。失敗しても払い出しは続ける（同期開始前に
  //   管理画面から補完できる）。
  if (tok.kind === 'nvms') {
    const { error: recErr } = await svc.from('recorders').insert({
      edge_id:      edge.id,
      vendor:       'nvms',
      model:        tok.name,
      host:         'uplink',            // 暫定（uplink 型は接続先を持たない）
      username:     '',
      password_enc: encryptSecret(''),
    })
    if (recErr) console.warn(`enroll: nvms recorder autocreate failed (edge ${edge.id}): ${recErr.message}`)
  }

  // 4) 払出。エッジは device_token で heartbeat / アップリンクを行う
  //    （nvms は device_token = NVMS_UPLINK_TOKEN）。
  return NextResponse.json(
    { edge_id: edge.id, device_token },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
