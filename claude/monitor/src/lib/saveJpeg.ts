/**
 * Save the currently-shown camera frame as a JPEG file.
 *
 * Live/grid frames are served by same-origin, session-authenticated API routes
 * (/api/edges/[id]/grid, /api/edges/[id]/cam/[cameraId]/snapshot), so we just
 * fetch the JPEG bytes and trigger a download. This works regardless of how the
 * frame is displayed (MJPEG <img>, go2rtc <video>, polled snapshot) and avoids
 * the cross-origin canvas-taint problem of grabbing pixels off the element.
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

/** Fetch a same-origin JPEG endpoint and download it as `filename`. */
export async function downloadJpeg(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { cache: 'no-store' })
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
