// Uses RESEND_API_KEY env var (add to .env.local)
export async function sendEmailNotification(to: string, subject: string, html: string): Promise<void> {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'reception@noreply.example.com', to, subject, html }),
    })
  } catch {
    console.error('[email] notification failed')
  }
}
