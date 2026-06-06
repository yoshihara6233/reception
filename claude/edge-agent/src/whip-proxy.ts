/**
 * Local WHIP proxy — strips TCP ICE candidates from LiveKit's SDP answer.
 *
 * Why this exists:
 *   LiveKit Cloud's WHIP server returns SDP answers whose `a=candidate:...`
 *   lines list TCP candidates BEFORE UDP candidates. ffmpeg 8.1's WHIP muxer
 *   does not skip TCP candidates — it bails on the first non-UDP one with:
 *     "Protocol tcp is not supported by RTC, choose udp"
 *   Result: live/VOD publish fails with code 251 even though the SDP
 *   exchange itself succeeded.
 *
 * What this does:
 *   Runs a tiny HTTP server on 127.0.0.1:<random>. Accepts
 *     POST /whip?upstream=<encoded LiveKit ingress URL>
 *   Forwards the SDP offer body to upstream, receives the SDP answer,
 *   removes lines matching `a=candidate:... tcp ...`, and returns the
 *   cleaned SDP to ffmpeg. The Location header (used by ffmpeg for the
 *   DELETE-on-stop trickle) is passed through unchanged, so subsequent
 *   resource lifecycle traffic goes direct to LiveKit, bypassing us.
 *
 * Lifecycle:
 *   Started once at edge-agent boot, stopped on SIGINT/SIGTERM. Both
 *   live.ts and vod.ts receive WHIP URLs already wrapped via wrapWhip().
 */
import { createServer, type Server } from 'node:http'
import { logger } from './logger.js'

export interface WhipProxyHandle {
  /** Base URL the edge-agent uses to wrap upstream WHIP URLs. */
  baseUrl: string
  stop: () => Promise<void>
}

/**
 * Remove TCP ICE candidate lines from an SDP. Keep `a=end-of-candidates`
 * and every non-candidate line untouched.
 *
 * Pattern matched (per RFC 8839): the candidate line has the shape
 *   a=candidate:<foundation> <component> <protocol> <priority> ...
 * We drop only entries where <protocol> is tcp (case-insensitive); UDP
 * candidates (the ones ffmpeg can actually use) are preserved.
 */
export function stripTcpCandidates(sdp: string): string {
  const sep = sdp.includes('\r\n') ? '\r\n' : '\n'
  return sdp
    .split(/\r?\n/)
    .filter((line) => !/^a=candidate:\S+\s+\d+\s+tcp\b/i.test(line))
    .join(sep)
}

/** Wrap an upstream WHIP publish URL so it routes through this proxy. */
export function wrapWhip(baseUrl: string, upstream: string): string {
  return `${baseUrl}/whip?upstream=${encodeURIComponent(upstream)}`
}

export async function startWhipProxy(): Promise<WhipProxyHandle> {
  return new Promise<WhipProxyHandle>((resolve) => {
    const server: Server = createServer((req, res) => {
      void handle(req, res).catch((e) => {
        logger.warn({ err: (e as Error).message }, 'whip-proxy: error')
        if (!res.headersSent) {
          res.statusCode = 502
          res.end('proxy error')
        }
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const baseUrl = `http://127.0.0.1:${port}`
      logger.info({ baseUrl }, 'whip-proxy: listening (strips TCP ICE candidates)')
      resolve({
        baseUrl,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (req.method !== 'POST' || url.pathname !== '/whip') {
    res.statusCode = 405
    res.end('method not allowed')
    return
  }
  const upstream = url.searchParams.get('upstream')
  if (!upstream) {
    res.statusCode = 400
    res.end('missing upstream')
    return
  }

  // Buffer the offer SDP, then forward.
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)

  const upRes = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? 'application/sdp' },
    body,
  })
  const respText = await upRes.text()
  const ctype = upRes.headers.get('content-type') ?? ''

  // Only mutate SDP responses; pass everything else through verbatim.
  const out = ctype.includes('sdp') ? stripTcpCandidates(respText) : respText
  const outBuf = Buffer.from(out, 'utf-8')

  const loc = upRes.headers.get('location')
  if (loc) res.setHeader('Location', loc)
  res.setHeader('Content-Type', ctype || 'application/sdp')
  // Set Content-Length explicitly so ffmpeg's WHIP client doesn't have to
  // handle Transfer-Encoding: chunked on the SDP answer body.
  res.setHeader('Content-Length', String(outBuf.length))
  res.statusCode = upRes.status
  res.end(outBuf)
}
