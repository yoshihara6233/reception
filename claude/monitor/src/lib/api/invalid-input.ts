import { NextResponse } from 'next/server'
import { logSecurityEventThrottled, requestIp } from '@/lib/security/events'

/**
 * 入力の検査 (zod) に通らなかった要求に 400 を返し、安全の出来事として記録する
 * (2026-10-30・自主診断 ASVS 16.3.3)。
 *
 * 以前は 400 を返すだけで、どこにも残していなかった。入力の検査を回り込もうとする試し
 * (型の違う値・範囲の外・余計な項目) が続いても気づけない。
 *
 * 記録するのは種類 (`input.invalid`)・道・利用者 ID・接続元・状態だけ。
 * **入力の中身・誤りの詳細 (どの項目のどの値か) は書かない** (秘密や個人の情報が混じりうる)。
 * 同じ道・同じ接続元からの続きは 60 秒に 1 行へ間引く (events.ts の logSecurityEventThrottled)。
 *
 * 応答の本文は今までどおり (`{ error: 'invalid_body' }` か、呼び出し側が渡したもの)。
 */
export function invalidInput(
  req: Request,
  body: Record<string, unknown> = { error: 'invalid_body' },
  actor?: string | null,
  status = 400,
): NextResponse {
  let path: string | null = null
  try { path = new URL(req.url).pathname } catch { /* 道が取れなくても記録は続ける */ }
  logSecurityEventThrottled({
    kind: 'input.invalid',
    actor: actor ?? null,
    ip: requestIp(req.headers),
    path,
    status,
  })
  return NextResponse.json(body, { status })
}
