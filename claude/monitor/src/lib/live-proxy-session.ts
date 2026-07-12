/**
 * live-proxy の HLS セッションクッキー（HMAC 署名・短TTL）。
 *
 * 背景（2026-07-12 実機診断）: go2rtc の HLS はセグメントが 0.5 秒刻みでライブバッファが
 * 数秒ぶんしか無い。proxy が毎リクエストで Supabase 認証（getUser + RLS照会 ≒ 1〜2秒）を
 * すると、セグメントを取りに行く頃にはバッファから追い出されて **404 → hls.js 致命エラー**
 * になる（ローカル直叩きは 200 なのにクラウド経由だけ落ちる根因）。
 *
 * 対策: 初回の stream.m3u8 だけフル認証し、その応答で本クッキーを発行。以降の
 * api/hls/*（プレイリスト/init/セグメント）はクッキーの HMAC 検証のみ（DB往復ゼロ）で
 * 通す。鍵は 案2 live-gate と同じ LIVE_SIGNING_SECRET を流用。
 *
 * 形式: `${exp}.${b64url(origin)}.${sig}` / sig = HMAC-SHA256(`${cameraId}\n${origin}\n${exp}`)
 * origin をペイロードに含めるので hls/* パスでは DB の origin 照会も不要。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const LIVE_PROXY_COOKIE_TTL_SEC = 600   // 10分（視聴継続中は stream.m3u8 再取得で更新）

export function liveProxyCookieName(cameraId: string): string {
  // クッキー名に使えない文字を除去（UUID想定だが防御的に）
  return `lp_${cameraId.replace(/[^a-zA-Z0-9-]/g, '')}`
}

function hmac(cameraId: string, origin: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${cameraId}\n${origin}\n${exp}`).digest('base64url')
}

/** クッキー値を生成。exp は epoch 秒。 */
export function makeLiveProxyCookie(cameraId: string, origin: string, secret: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + LIVE_PROXY_COOKIE_TTL_SEC
  const originB64 = Buffer.from(origin, 'utf8').toString('base64url')
  return `${exp}.${originB64}.${hmac(cameraId, origin, exp, secret)}`
}

/** 検証。有効なら埋め込まれた origin を返す。無効/期限切れ/改竄は null。 */
export function verifyLiveProxyCookie(
  value: string | undefined,
  cameraId: string,
  secret: string,
  nowMs: number,
): string | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [expStr, originB64, sig] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return null
  let origin: string
  try { origin = Buffer.from(originB64, 'base64url').toString('utf8') } catch { return null }
  const expected = hmac(cameraId, origin, exp, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return origin
}
