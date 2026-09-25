/**
 * intereco-edge-images — Cloudflare Worker（R2 バインディング）。
 *
 * 目的: ライブ画像（16分割 grid / カメラ別 snapshot）の授受を **自社ドメイン**で行い、
 *   Supabase の課金エグレスを止めつつ、**eo光が `*.r2.cloudflarestorage.com` を SNI 遮断**
 *   している回線でも動くようにする（2026-08-03 実測: r2.cloudflarestorage.com のみ遮断、
 *   genesis-edge.com / r2.dev は到達可）。R2 の S3 API を使わず、R2 バインディング経由で
 *   Worker が直接読み書きするため、遮断ホスト名を一切踏まない。
 *
 * ルート: img.genesis-edge.com/v1/*
 *   PUT /v1/<key>?exp=&sig=   … エッジがフレームを上書き（monitor 発行の PUT 署名）
 *   GET /v1/<key>?exp=&sig=   … ブラウザが取得（monitor 発行の GET 署名・302 先）
 *   <key> は monitor と共通: edges/<edgeId>/grid.jpg / edges/<edgeId>/cam/<cameraId>/snapshot.jpg
 *
 *   PUT|GET|HEAD|DELETE /v1/video/<sessionId>/<name>?exp=&sig=  … G・VMS の遠隔視聴（HLS）の
 *     区切り・初期化区切り・プレイリスト（name = slot0〜slot15 / init / playlist）。
 *     PUT は拠点、GET/HEAD/DELETE は monitor のサーバ（届いたかの確認・視聴者への中継・片付け）。
 *     署名はどれも monitor だけが作れる。視聴者のブラウザへはこの URL を渡さない（中継する）。
 *     monitor が R2 を S3 API で読むと、キーの権限や設定に左右される（2026-09-25 本番で
 *     読めずに映らなかった）ので、書く・読む・消すをこの Worker にそろえる。
 *     S3 の署名付き URL（*.r2.cloudflarestorage.com）は遮断回線で届かない（2026-09-25 .200 で
 *     TLS handshake failure を実測）ため、静止画と同じくこの Worker を通す。
 *
 * 認証: monitor（lib/storage/edge-images-sign.ts）と**同じ鍵**の短TTL HMAC。
 *   正規化文字列は厳密一致で `${method}\n${key}\n${exp}`。
 *   method を含めるので **PUT 署名で GET はできない**（逆も同様）。
 *   鍵未設定・署名不正・失効・想定外の例外はすべて 403（fail-closed）。
 *
 * Secrets（wrangler secret put・monitor 側 env と一致させる）:
 *   EDGE_IMAGES_SIGNING_SECRET … = Vercel EDGE_IMAGES_SIGNING_SECRET
 * Bindings:
 *   IMAGES … R2 バケット（既定 edge-images）
 */

const PREFIX = '/v1/'
/** キーの形を限定する（任意パスへの書込・読出を防ぐ）。 */
const KEY_RE = /^edges\/[0-9a-fA-F-]{36}\/(grid\.jpg|cam\/[0-9a-fA-F-]{36}\/snapshot\.jpg)$/
/** 遠隔視聴（HLS）の置き場。monitor の lib/storage/video-r2.ts の videoKey と同じ形。 */
const VIDEO_KEY_RE = /^video\/[0-9a-fA-F-]{36}\/(slot(?:[0-9]|1[0-5])|init|playlist)$/
/** 区切りは TS / fMP4、プレイリストは m3u8。これ以外の形式では保存しない */
const VIDEO_TYPES = new Set(['video/mp2t', 'video/mp4', 'application/vnd.apple.mpegurl'])
/** 区切り 1 本の上限（4 秒の録画再生の区切りでも数 MB。それを大きく超えるものは受けない） */
const VIDEO_MAX_BYTES = 32 * 1024 * 1024

export default {
  async fetch(request, env) {
    try {
      if (!env.EDGE_IMAGES_SIGNING_SECRET) return deny('gate misconfigured', 500)
      if (!env.IMAGES) return deny('bucket not bound', 500)

      const url = new URL(request.url)
      if (!url.pathname.startsWith(PREFIX)) return deny('not found', 404)

      const key = decodeURIComponent(url.pathname.slice(PREFIX.length))
      const isVideo = VIDEO_KEY_RE.test(key)
      if (!isVideo && !KEY_RE.test(key)) return deny('bad key')

      const method = request.method.toUpperCase()
      const allowed = isVideo ? ['PUT', 'GET', 'HEAD', 'DELETE'] : ['PUT', 'GET', 'HEAD']
      if (!allowed.includes(method)) return deny('method not allowed', 405)
      // HEAD は GET 署名で許可する（存在確認用）。
      const signedMethod = method === 'HEAD' ? 'GET' : method

      const exp = url.searchParams.get('exp')
      const sig = url.searchParams.get('sig')
      if (!exp || !sig || !/^\d+$/.test(exp)) return deny('missing token')
      if (Number(exp) < Math.floor(Date.now() / 1000)) return deny('token expired')

      const expected = await hmacHex(
        env.EDGE_IMAGES_SIGNING_SECRET,
        `${signedMethod}\n${key}\n${exp}`,
      )
      if (!safeEqual(expected, sig.toLowerCase())) return deny('bad signature')

      if (method === 'PUT' && isVideo) {
        if (!request.body) return deny('empty body', 400)
        const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
        if (!VIDEO_TYPES.has(type)) return deny('bad content type', 415)
        const len = Number(request.headers.get('Content-Length') || '0')
        if (len > VIDEO_MAX_BYTES) return deny('too large', 413)
        await env.IMAGES.put(key, request.body, {
          httpMetadata: { contentType: type, cacheControl: 'no-store' },
        })
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
      }

      if (isVideo && method === 'DELETE') {
        await env.IMAGES.delete(key) // 無いキーでも成功する
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
      }

      if (isVideo) {
        // GET / HEAD。形式は置いたときのものを返す
        const obj = method === 'HEAD' ? await env.IMAGES.head(key) : await env.IMAGES.get(key)
        if (!obj) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
        const headers = new Headers({
          'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Length': String(obj.size),
        })
        return new Response(method === 'HEAD' ? null : obj.body, { status: 200, headers })
      }

      if (method === 'PUT') {
        if (!request.body) return deny('empty body', 400)
        await env.IMAGES.put(key, request.body, {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: 'no-store' },
        })
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
      }

      const obj = await env.IMAGES.get(key)
      if (!obj) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

      // ライブは常に最新フレームが要る → 中間・ブラウザとも一切キャッシュさせない。
      const headers = new Headers({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      })
      if (method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(obj.body, { status: 200, headers })
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
