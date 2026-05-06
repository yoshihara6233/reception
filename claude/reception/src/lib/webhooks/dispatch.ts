import crypto from 'crypto'

// VULN-011 FIX: Validate webhook URLs to prevent SSRF against internal network resources.
// Only public HTTP/HTTPS URLs with a hostname (not localhost/private IPs) are allowed.
function isAllowedWebhookUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  // Block localhost and loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
  // Block RFC-1918 private ranges (10.x, 172.16-31.x, 192.168.x)
  if (/^10\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (/^192\.168\./.test(host)) return false
  // Block cloud metadata endpoints
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false
  return true
}

export async function dispatchWebhook(
  url: string,
  secret: string,
  eventType: string,
  payload: object
): Promise<{ success: boolean; httpStatus?: number; durationMs: number; error?: string }> {
  // Validate URL before fetching
  if (!isAllowedWebhookUrl(url)) {
    return { success: false, durationMs: 0, error: `Blocked URL: ${url}` }
  }

  const body = JSON.stringify({ event: eventType, ts: new Date().toISOString(), ...payload })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Reception-Signature': `sha256=${sig}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
    return { success: res.ok, httpStatus: res.status, durationMs: Date.now() - start }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, durationMs: Date.now() - start, error: message }
  }
}
