/**
 * F106: i-PRO BCP snapshot fetcher.
 *
 * Implements ① (latest snapshot) and ② (historical snapshot) for the BCP
 * 8-枚タイムライン feature.
 *
 * Latest:   GET /cgi-bin/snapshot.cgi?ch=<N>
 * Past:     GET /cgi-bin/snapshot.cgi?ch=<N>&time=<unix_ts>
 *           ↑ FW v3+ only. v1/v2 ignore the `time` parameter and silently
 *             return the latest frame. Caller can detect by inspecting the
 *             returned source string and decide whether to retry.
 *
 * Both endpoints require Digest authentication. The CGI client embedded in
 * the central-mode i-PRO adapter (adapters/i-pro/_common/cgi-client.ts) is
 * not reused here on purpose — it carries stateful nonce caching across
 * channels that we don't need on the edge BCP path (fewer than 8 calls per
 * camera per BCP event).
 */
import { digestFetch, DigestAuthError } from '../util/digest-auth.js'

export interface IproSnapshotOptions {
  host:        string
  /** Default 80. HTTPS is rare on i-PRO NVRs — use plain HTTP. */
  port?:       number
  username:    string
  password:    string
  /** 1-based channel number. */
  channel:     number
  /**
   * If provided, requests a frame at this past instant. FW v3+ honors this;
   * older firmware silently returns the latest frame.
   * If undefined / null, returns the latest frame.
   */
  at?:         Date | null
  timeoutMs?:  number
  /** Test hook. */
  fetchImpl?:  typeof fetch
}

export interface IproSnapshotResult {
  body:     Buffer
  /**
   * 'historical' if we asked for a past instant AND the server is FW v3+
   *   (cannot be detected with 100% certainty — we treat any 200 response to
   *   a `time` query as historical).
   * 'latest'     for current-frame requests, or when we asked for past but
   *   omitted the time parameter (v1/v2 fallback).
   */
  source:   'historical' | 'latest'
}

export async function fetchIproSnapshot(
  opts: IproSnapshotOptions,
): Promise<IproSnapshotResult> {
  const port    = opts.port ?? 80
  const url     = new URL(`http://${opts.host}:${port}/cgi-bin/snapshot.cgi`)
  url.searchParams.set('ch', String(opts.channel))

  const wantsPast = opts.at instanceof Date
  let source: IproSnapshotResult['source'] = 'latest'
  if (wantsPast) {
    const ts = Math.floor(opts.at!.getTime() / 1000)
    url.searchParams.set('time', String(ts))
    source = 'historical'
  }

  const body = await digestFetch(url.toString(), {
    username:  opts.username,
    password:  opts.password,
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  })

  // JPEG magic check (SOI marker 0xFFD8)
  if (body.length < 2 || body[0] !== 0xff || body[1] !== 0xd8) {
    throw new DigestAuthError(
      `i-PRO snapshot response is not a JPEG (${body.length} bytes, ch=${opts.channel})`,
    )
  }
  return { body, source }
}
