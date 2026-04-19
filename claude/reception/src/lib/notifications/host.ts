import { sendEmailNotification } from './email'

interface StaffMember {
  id: string
  name: string
  email: string | null
  slack_member_id: string | null
}

interface VisitInfo {
  visitor_name: string
  company: string
  purpose: string
  store_name: string
  check_in_at: string
}

/**
 * Sends a host notification when a visitor checks in for a specific contact person.
 * Fire-and-forget — call without await. Errors are logged only.
 */
export async function sendHostNotification(
  staff: StaffMember,
  visit: VisitInfo,
  slackWebhookUrl?: string | null
): Promise<void> {
  const promises: Promise<void>[] = []

  // Email notification
  if (staff.email) {
    const subject = `[受付] ${visit.visitor_name}様（${visit.company}）がいらっしゃいました`
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1e3a5f; border-radius: 12px; padding: 20px; color: white; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 16px;">🛎 来客のお知らせ</h2>
        </div>
        <p style="color: #374151; font-size: 15px;">${staff.name} さん</p>
        <p style="color: #374151; font-size: 15px;">
          <strong>${visit.visitor_name}</strong> 様（${visit.company}）が
          <strong>${visit.store_name}</strong> の受付にいらっしゃいました。
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; width: 100px;">来訪目的</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 500;">${visit.purpose}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">チェックイン</td>
            <td style="padding: 8px 0; color: #111827;">${new Date(visit.check_in_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
          </tr>
        </table>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
          Reception Kiosk — 自動通知メール
        </p>
      </div>
    `
    promises.push(
      sendEmailNotification(staff.email, subject, html).catch(e =>
        console.error(`[host-notify] email failed for ${staff.id}:`, e)
      )
    )
  }

  // Slack channel notification with @mention
  if (slackWebhookUrl && staff.slack_member_id) {
    const mention = `<@${staff.slack_member_id}>`
    const message = `🛎 ${mention} ${visit.visitor_name}様（${visit.company}）が${visit.store_name}にいらっしゃいました。来訪目的: ${visit.purpose}`
    promises.push(
      fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
        signal: AbortSignal.timeout(3000),
      })
        .then(() => undefined)
        .catch(e => console.error(`[host-notify] slack mention failed:`, e))
    )
  }

  await Promise.allSettled(promises)
}
