/**
 * F106: Uniview BCP snapshot fetcher.
 *
 * Implements ① (latest snapshot) for the BCP 8-枚タイムライン feature.
 * ② (historical / past instant) is structurally supported but degrades to
 * "latest" because Uniview's LAPI does not expose a time-indexed snapshot
 * endpoint analogous to i-PRO's `?time=<ts>`. Full historical retrieval
 * requires ONVIF Profile-G (ReplayControl + RetrieveRecordings) which adds
 * SOAP overhead unsuitable for the simple BCP fetch path. Reserved for a
 * follow-up if customer demand surfaces.
 *
 * Latest:   GET /LAPI/V1.0/Channels/<ch>/Media/Video/Snapshot
 * Auth:     Digest (RFC 7616, MD5 only — NetSDK firmware)
 *
 * Path conventions are confirmed against:
 *   - Uniview NVR301/501 LAPI V1.x reference
 *   - NVR401/501 NetSDK programming guide
 * Older NVR201 series exposes /cgi-bin/snapshot.cgi with the same parameters
 * as Hikvision — not supported here yet.
 */
import { digestFetch, DigestAuthError } from '../util/digest-auth.js'

export interface UniviewSnapshotOptions {
  host:        string
  /** Default 80. */
  port?:       number
  username:    string
  password:    string
  /** 1-based channel number. */
  channel:     number
  /**
   * If provided, the call still returns a latest frame because Uniview LAPI
   * has no built-in historical snapshot endpoint. The parameter is accepted
   * so callers (BCP) can use a single dispatch signature across vendors.
   */
  at?:         Date | null
  timeoutMs?:  number
  fetchImpl?:  typeof fetch
}

export interface UniviewSnapshotResult {
  body:     Buffer
  source:   'historical' | 'latest'
}

export async function fetchUniviewSnapshot(
  opts: UniviewSnapshotOptions,
): Promise<UniviewSnapshotResult> {
  const port = opts.port ?? 80
  // LAPI V1.0 snapshot endpoint. The channel number is part of the path
  // (not a query parameter), and the response is a JPEG body.
  const url  = `http://${opts.host}:${port}/LAPI/V1.0/Channels/${opts.channel}/Media/Video/Snapshot`

  const body = await digestFetch(url, {
    username:  opts.username,
    password:  opts.password,
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  })

  if (body.length < 2 || body[0] !== 0xff || body[1] !== 0xd8) {
    throw new DigestAuthError(
      `Uniview snapshot response is not a JPEG (${body.length} bytes, ch=${opts.channel})`,
    )
  }
  // Historical not actually supported — always "latest". Caller (BCP) sees
  // the `latest` source on past offsets and records it in bcp_clips.source.
  return { body, source: 'latest' }
}
