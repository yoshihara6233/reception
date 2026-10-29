/**
 * ライブ (live-proxy) と録画 (vod-hls) の中継で、上流 (拠点の go2rtc・Frigate) へ送るときの守り
 * (2026-10-29・自主診断 ASVS 13.2.4・1.1.1・3.2.1・4.1.1・15.3.2・16.5.2)。
 *
 * 中継は、全拠点で共通の Cloudflare Access のサービストークンを付けて上流へ送る。上流の住所は
 * 管理者が画面で決められる (recorder_cameras.hls_url・edge_devices.go2rtc_host・recorders.live_host)
 * ので、外部のホストを書かれるとトークンがそこへ送られる。次の 4 つを守る:
 *   1. 宛先: https で、許した名前の末尾 (UPSTREAM_ALLOWED_HOST_SUFFIXES・既定 .genesis-edge.com =
 *      トークンが効く Cloudflare のゾーン) のホストだけ。それ以外へはトークンを付けて送らない
 *   2. 経路: 画面から来た経路の部品に `.`・`..`・`/`・`\`・`%` を含むものは断る (fetch が `..` を
 *      畳んで、許した経路の外 (go2rtc・Frigate の制御 API) に届かないように)
 *   3. 応答の型: HLS の型だけを返す。それ以外は application/octet-stream にする (上流が HTML を
 *      返しても、このサイトの上で描画させない)
 *   4. 転送を追わず (トークンを付けたまま別のホストへ行かない)、時間切れを付ける
 */

const DEFAULT_SUFFIXES = ['.genesis-edge.com']

function allowedSuffixes(): string[] {
  const env = process.env.UPSTREAM_ALLOWED_HOST_SUFFIXES
  const list = (env ? env.split(',') : DEFAULT_SUFFIXES).map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.map((s) => (s.startsWith('.') ? s : `.${s}`))
}

/** 上流の住所 (URL) から、送ってよい origin を返す。だめなら null。 */
export function allowedUpstreamOrigin(src: string | null | undefined): string | null {
  if (!src) return null
  let u: URL
  try { u = new URL(src) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  const ok = allowedSuffixes().some((s) => host.endsWith(s) && host.length > s.length)
  return ok ? u.origin : null
}

/**
 * 画面から来た経路の部品を確かめて繋ぐ。prefixes のどれかで始まらなければ null。
 * Next が既に解いた後の部品を受けるので、`%2e%2e` は `..` として届く。
 */
export function safeSubPath(segments: string[] | undefined, prefixes: string[]): string | null {
  const segs = segments ?? []
  if (segs.length === 0) return null
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || /[/%\\\u0000]/.test(s)) return null
  }
  const p = segs.join('/')
  return prefixes.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x)) ? p : null
}

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl',
  'video/mp2t', 'video/mp4', 'video/iso.segment', 'audio/mp4', 'audio/aac', 'application/octet-stream',
])

/** 上流の Content-Type のうち、返してよいもの。それ以外は application/octet-stream。 */
export function safeContentType(ct: string | null): string {
  const base = (ct ?? '').split(';')[0].trim().toLowerCase()
  return HLS_TYPES.has(base) ? base : 'application/octet-stream'
}

/** 上流への fetch。転送を追わず (3xx は失敗)、時間切れを付ける。 */
export async function fetchUpstream(target: string, headers: Record<string, string>, timeoutMs = 30_000): Promise<Response> {
  return fetch(target, { headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
}
