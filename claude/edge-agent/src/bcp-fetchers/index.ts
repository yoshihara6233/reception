/**
 * F106: BCP snapshot dispatcher.
 *
 * Single entry point that BCP mode (modes/bcp.ts) calls to fetch a single
 * JPEG frame from any supported vendor — current ("latest") or past instant
 * ("historical"). Returns null on any vendor not implemented yet so the
 * caller falls back to its legacy `latest.jpg` path.
 *
 * Supported today (F106):
 *   - 'ipro'    → CGI snapshot.cgi (?time=<ts> for past on FW v3+)
 *   - 'uniview' → LAPI Media/Video/Snapshot (latest only; past degrades)
 *
 * Frigate is handled directly in modes/bcp.ts because its past-frame path
 * goes through ffmpeg (clip.mp4 → 1 frame extract) and is shaped differently.
 */
import type { Vendor, CameraDescriptor } from '../types.js'
import { fetchIproSnapshot } from './ipro.js'
import { fetchUniviewSnapshot } from './uniview.js'

export interface SnapshotFetchResult {
  body:    Buffer
  /** What we actually got. 'latest' means past-instant degraded. */
  source:  'historical' | 'latest'
}

/**
 * Fetch one BCP snapshot. Returns null if the vendor has no implementation
 * (caller falls back to legacy latest.jpg fast path).
 *
 * @param camera   Camera descriptor (vendor + connection info).
 * @param at       If provided, asks for a past instant. Null/undefined ⇒ latest.
 */
export async function fetchBcpSnapshot(
  camera: CameraDescriptor,
  at:     Date | null,
): Promise<SnapshotFetchResult | null> {
  const vendor: Vendor = camera.recorder.vendor
  const common = {
    host:     camera.recorder.host,
    port:     undefined,   // BCP HTTP port; rtsp_port from CameraDescriptor is RTSP-only
    username: camera.recorder.username,
    password: camera.recorder.password,
    channel:  camera.channel,
    at,
  }

  if (vendor === 'ipro') {
    return fetchIproSnapshot(common)
  }
  if (vendor === 'uniview') {
    return fetchUniviewSnapshot(common)
  }
  // 'frigate' is handled by the caller via the historical clip.mp4 + ffmpeg
  // path. Other vendors fall through and the caller will use latest.jpg
  // via snapshotUrl() — which currently returns null for non-Frigate.
  return null
}
