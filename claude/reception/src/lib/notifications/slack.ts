export async function sendSlackNotification(webhookUrl: string, message: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 500)
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: controller.signal,
    })
  } catch {
    // fire-and-forget: log but don't throw
    console.error('[slack] notification failed')
  } finally {
    clearTimeout(timeout)
  }
}
