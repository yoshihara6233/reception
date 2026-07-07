/**
 * リモート Frigate MJPEG ライブ（Cloudflare Tunnel 経由）の署名URL。
 *
 * 案2: カメラ側 Cloudflare Access のログインを、アプリ発行の短TTL HMAC 署名に置き換える。
 * monitor（本ファイル）が `exp`(失効UNIX秒) と `sig`(HMAC-SHA256) を URL に付与し、
 * Cloudflare Worker `live-gate` が **同じ鍵 LIVE_SIGNING_SECRET** で検証して Frigate へ通す。
 * → エンドユーザは monitor ログインのみ、カメラ側の CF ログインは不要。低遅延の MJPEG を維持。
 *
 * 署名鍵が未設定なら null を返す＝呼び出し側は従来の生URL（CFログイン方式）にフォールバックする
 * ので、本 PR をマージしても Worker/鍵の設定が済むまで挙動は一切変わらない。
 *
 * 正規化文字列は Worker と厳密一致させる: `${pathname}\n${exp}`。
 * カメラは pathname（例 `/api/cam101`）に含まれるため、署名は「そのカメラ・その失効まで」に束縛され、
 * 別カメラへの流用や失効後の再利用ができない（bearer 的だが短TTL＝リプレイ窓が小さい）。
 */
import { createHmac } from 'node:crypto'

/** 署名URLの既定TTL（秒）。env LIVE_SIGN_TTL_SEC で上書き可。 */
export const LIVE_SIGN_TTL_SEC = Number(process.env.LIVE_SIGN_TTL_SEC ?? 7200) // 2h

/** Worker と一致させる正規化文字列。 */
function canonical(pathname: string, exp: number): string {
  return `${pathname}\n${exp}`
}

/**
 * リモート(スキーム付き=トンネル)の Frigate MJPEG URL を組み立てる。
 * live_host が bare host（LAN・スキーム無し）や未設定なら null（＝リモート対象外）。
 */
export function buildRemoteMjpegUrl(
  liveHost: string | null,
  frigateCamera: string | null,
  opts?: { fps?: number; height?: number },
): string | null {
  if (!liveHost || !frigateCamera) return null
  if (!/^https?:\/\//.test(liveHost)) return null // bare host は LAN 用（WebRTC）＝対象外
  const fps    = opts?.fps ?? 5
  const height = opts?.height ?? 720
  return `${liveHost.replace(/\/+$/, '')}/api/${frigateCamera}?fps=${fps}&height=${height}`
}

/**
 * MJPEG URL に短TTL HMAC 署名を付与する。鍵未設定なら null。
 * @returns 署名済みURL、または null（署名無効＝呼び出し側はフォールバック）
 */
export function signLiveUrl(rawUrl: string, ttlSec: number = LIVE_SIGN_TTL_SEC): string | null {
  const secret = process.env.LIVE_SIGNING_SECRET
  if (!secret) return null
  let u: URL
  try { u = new URL(rawUrl) } catch { return null }
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec)
  const sig = createHmac('sha256', secret).update(canonical(u.pathname, exp)).digest('hex')
  u.searchParams.set('exp', String(exp))
  u.searchParams.set('sig', sig)
  return u.toString()
}
