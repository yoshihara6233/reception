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
import { createSupabaseService } from '@/lib/supabase/server'
import { hashEnrollToken } from '@/lib/admin/enrollment'
import { clientIp, rateLimitAllows } from '@/lib/rate-limit'

const Body = z.object({ token: z.string().min(16).max(256) })

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

  const token_hash = hashEnrollToken(parsed.data.token)
  const nowIso = new Date().toISOString()

  // 1) 事前検証（未使用・未失効）。よくある不正トークンはエッジ行を作らず即 403。
  const { data: tok } = await svc
    .from('enrollment_tokens')
    .select('id, store_id, name, camera_tier, used_at, expires_at')
    .eq('token_hash', token_hash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle()
  if (!tok) return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 403 })

  // 2) エッジ行を作成（device_token 払出）。store/name/tier はトークン由来。
  const device_token = randomBytes(32).toString('hex')
  const { data: edge, error: edgeErr } = await svc
    .from('edge_devices')
    .insert({
      store_id:    tok.store_id,
      name:        tok.name,
      device_token,
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

  // 4) 払出。エッジは device_token で heartbeat / /api/edge/bootstrap を行う。
  return NextResponse.json(
    { edge_id: edge.id, device_token },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
