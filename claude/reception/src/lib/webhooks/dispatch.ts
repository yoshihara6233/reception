import crypto from 'crypto'

export async function dispatchWebhook(
  url: string,
  secret: string,
  eventType: string,
  payload: object
): Promise<{ success: boolean; httpStatus?: number; durationMs: number; error?: string }> {
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
