/**
 * intereco-live-gate — Cloudflare Worker.
 *
 * 目的: 店舗トンネル(poc-beelink.genesis-edge.com)の Frigate ライブ(/api/*)について、
 *   カメラ側 Cloudflare Access のブラウザログインを廃し、monitor が発行する
 *   **短TTL HMAC 署名**で通す（案2）。Access は該当パスを Bypass にし、本 Worker を唯一の
 *   認証ゲートにする（fail-closed: 判定不能は必ず 403）。
 *
 * 2系統のトラフィックを捌く:
 *  (A) ブラウザの MJPEG <img> … 署名(?exp&sig)必須。monitor の lib/live-sign.ts と一致。
 *  (B) monitor サーバ側の go2rtc/HLS プロキシ … CF Access Service Token ヘッダ付き。
 *      Access を Bypass にしたぶん、ここで **同じ token を検証**して通す（素通しにしない）。
 *
 * 正規化文字列(署名対象)は monitor と厳密一致: `${pathname}\n${exp}`。
 * カメラは pathname(/api/<cam>)に含まれ、署名は「そのカメラ・その失効まで」に束縛される。
 *
 * Secrets（wrangler secret put で設定・monitor 側 env と一致させる）:
 *   LIVE_SIGNING_SECRET          … 署名鍵（= Vercel LIVE_SIGNING_SECRET）
 *   SERVICE_TOKEN_CLIENT_ID      … = Vercel GO2RTC_CF_ACCESS_CLIENT_ID
 *   SERVICE_TOKEN_CLIENT_SECRET  … = Vercel GO2RTC_CF_ACCESS_CLIENT_SECRET
 */

export default {
  async fetch(request, env) {
    try {
      // (B) サーバ側 Service Token 呼び出し（go2rtc HLS プロキシ等）を先に処理。
      const cid = request.headers.get('CF-Access-Client-Id')
      if (cid) {
        const csec = request.headers.get('CF-Access-Client-Secret')
        if (
          env.SERVICE_TOKEN_CLIENT_ID &&
          safeEqual(cid, env.SERVICE_TOKEN_CLIENT_ID) &&
          safeEqual(csec || '', env.SERVICE_TOKEN_CLIENT_SECRET || '')
        ) {
          return fetch(request) // origin(トンネル)へ素通し。Worker は自ルートに再帰しない。
        }
        return deny('invalid service token')
      }

      // (A) ブラウザ MJPEG … 短TTL HMAC 署名を検証。
      if (!env.LIVE_SIGNING_SECRET) return deny('gate misconfigured', 500)
      const url = new URL(request.url)
      const exp = url.searchParams.get('exp')
      const sig = url.searchParams.get('sig')
      if (!exp || !sig || !/^\d+$/.test(exp)) return deny('missing token')
      const now = Math.floor(Date.now() / 1000)
      if (Number(exp) < now) return deny('token expired')

      const expected = await hmacHex(env.LIVE_SIGNING_SECRET, `${url.pathname}\n${exp}`)
      if (!safeEqual(expected, sig.toLowerCase())) return deny('bad signature')

      return fetch(request) // 署名OK → origin へ素通し。
    } catch {
      return deny('gate error', 403) // 例外は fail-closed。
    }
  },
}

function deny(msg, status = 403) {
  return new Response(msg, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 長さ非依存の定数時間比較（タイミング攻撃対策）。 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
