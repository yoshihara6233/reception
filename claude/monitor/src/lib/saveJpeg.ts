/**
 * Save the currently-shown camera frame as a JPEG file.
 *
 * Live/grid frames come from session-authenticated API routes
 * (/api/edges/[id]/grid, /api/edges/[id]/cam/[cameraId]/snapshot). We fetch the
 * JPEG bytes and trigger a download, which works regardless of how the frame is
 * displayed (MJPEG <img>, go2rtc <video>, polled snapshot) and avoids the
 * cross-origin canvas-taint problem of grabbing pixels off the element.
 *
 * ⚠ それらのルートは R2 移行（2026-08-03）以降、オブジェクトが R2 にあると
 * `img.genesis-edge.com` へ 302 する。`<img>` は CORS 不要なので表示は通るが、
 * `fetch()` はリダイレクト先で `Access-Control-Allow-Origin` が無く弾かれる。
 * ＝「見えているのに保存だけ失敗」になる。**必ず `?download=1` を付けて**
 * ルート側にバイトを中継させ、同一オリジンのまま受け取ること。
 */

/** YYYYMMDD_HHMMSS in JST — for self-documenting filenames. */
export function jstStamp(d: Date = new Date()): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}` +
    `_${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}${p(jst.getUTCSeconds())}`
  )
}

/**
 * 画像ルートに `?download=1` を付ける（既存クエリは保持）。
 * これが付いているとルートは 302 せずバイトを中継するので、fetch が CORS で
 * 落ちない。純関数にしてあるのは、この1行が抜けると保存が静かに壊れるため。
 */
export function withDownloadParam(url: string, origin = 'http://localhost'): string {
  const u = new URL(url, origin)
  u.searchParams.set('download', '1')
  return u.origin === origin ? `${u.pathname}${u.search}` : u.toString()
}

/** Fetch a same-origin JPEG endpoint and download it as `filename`. */
export async function downloadJpeg(url: string, filename: string): Promise<void> {
  const target = withDownloadParam(url, window.location.origin)
  const res = await fetch(target, { cache: 'no-store' })
  if (!res.ok) throw new Error(`snapshot ${res.status}`)
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Revoke after the click has had a tick to start the download.
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
  }
}
