/**
 * Email delivery via Resend API.
 * Requires RESEND_API_KEY env var.
 *
 * Used for BCP (J-Alert) notifications. All emails sent from:
 *   bcp@noreply.intareco.jp
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS   = 'bcp@noreply.intareco.jp'

interface ResendAttachment {
  filename: string
  content: string  // base64-encoded
}

interface ResendEmailPayload {
  from: string
  to: string[]
  subject: string
  html: string
  attachments?: ResendAttachment[]
}

/**
 * Send an email via Resend.
 * Silently catches errors (logs to console.error).
 *
 * @param to          Single address or array of addresses
 * @param subject     Email subject line
 * @param html        HTML body
 * @param attachments Optional file attachments (e.g. PDF reports)
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  attachments?: Array<{ filename: string; content: Buffer }>,
  from?: string,
): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY is not set — skipping email send')
    return { ok: false }
  }

  const toAddresses = Array.isArray(to) ? to : [to]

  const payload: ResendEmailPayload = {
    from: from ?? FROM_ADDRESS,
    to: toAddresses,
    subject,
    html,
  }

  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString('base64'),
    }))
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(`[email] Resend API error ${res.status}: ${body}`)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('[email] Failed to send email:', err)
    return { ok: false }
  }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** Sender for account/security mail (verified Resend domain). */
export const SECURITY_FROM_ADDRESS = 'Intereco Monitor <no-reply@noreply.intareco.jp>'

/**
 * Password reset email. The reset link carries a one-time recovery token that
 * is ONLY delivered here (never returned to the browser), so possession of the
 * email proves identity.
 */
export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  const subject = '[Intereco Monitor] パスワード再設定のご案内'
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1e293b">🔑 パスワード再設定</h2>
  <p>Intereco Monitor のパスワード再設定がリクエストされました。<br>
  下のボタンから新しいパスワードを設定してください。</p>

  <p style="margin:24px 0">
    <a href="${escapeHtml(resetUrl)}"
       style="display:inline-block;background:#0f172a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
      パスワードを再設定する
    </a>
  </p>

  <p style="font-size:12px;color:#666">ボタンが開けない場合は、次のURLをブラウザに貼り付けてください：<br>
    <span style="word-break:break-all;color:#2563eb">${escapeHtml(resetUrl)}</span></p>

  <p style="font-size:12px;color:#666">このリンクは <b>1時間</b> で失効します。一度のみ有効です。</p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999">
    このメールはIntarecoモニタリングシステムから自動送信されています。<br>
    パスワード再設定に心当たりがない場合は、このメールを破棄してください。<br>
    お客様のパスワードは変更されません。
  </p>
</body>
</html>
`.trim()
  return { subject, html }
}

// ---------------------------------------------------------------------------
// Email templates (Japanese)
// ---------------------------------------------------------------------------

export interface BcpAlertStartedParams {
  storeName: string
  alertType: string
  alertTime: string   // human-readable datetime string
  eventUrl: string
  isTest: boolean
}

/**
 * Sent immediately when a BCP event is triggered.
 * Notifies recipients that recording has started.
 */
export function bcpAlertStartedEmail(
  params: BcpAlertStartedParams,
): { subject: string; html: string } {
  const { storeName, alertType, alertTime, eventUrl, isTest } = params
  const testLabel = isTest ? ' TEST' : ''

  const subject = `[BCP${testLabel}] Jアラート発令 - ${storeName} (${alertType})`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  ${isTest ? '<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;border-radius:4px;font-weight:bold">⚠️ これはテスト通知です</p>' : ''}

  <h2 style="color:#c0392b">🚨 Jアラート発令通知</h2>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;width:140px;border:1px solid #ddd">店舗名</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(storeName)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">アラート種別</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertType)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">発令日時</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertTime)}</td>
    </tr>
  </table>

  <p>店舗の防犯カメラによる録画を開始しました。録画完了後、改めてご連絡いたします。</p>

  <p>
    <a href="${eventUrl}"
       style="display:inline-block;background:#c0392b;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold">
      BCPイベントを確認する
    </a>
  </p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999">
    このメールはIntarecoモニタリングシステムから自動送信されています。<br>
    心当たりのない場合は、このメールを無視してください。
  </p>
</body>
</html>
`.trim()

  return { subject, html }
}

// ---------------------------------------------------------------------------

export interface BcpCompletedParams {
  storeName: string
  alertType: string
  alertTime: string
  eventUrl: string
  isTest: boolean
  clipCount: number
}

/**
 * Sent when all camera clips have been uploaded and the report is ready.
 * PDF report is attached separately via the `attachments` parameter of sendEmail.
 */
export function bcpCompletedEmail(
  params: BcpCompletedParams,
): { subject: string; html: string } {
  const { storeName, alertType, alertTime, eventUrl, isTest, clipCount } = params
  const testLabel = isTest ? ' TEST' : ''

  const subject = `[BCP完了${testLabel}] 録画・報告書 - ${storeName}`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  ${isTest ? '<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;border-radius:4px;font-weight:bold">⚠️ これはテスト通知です</p>' : ''}

  <h2 style="color:#27ae60">✅ BCPイベント完了通知</h2>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;width:140px;border:1px solid #ddd">店舗名</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(storeName)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">アラート種別</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertType)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">発令日時</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertTime)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">録画クリップ数</td>
      <td style="padding:8px;border:1px solid #ddd">${clipCount}件</td>
    </tr>
  </table>

  <p>録画クリップのアップロードが完了しました。報告書（PDF）を添付しています。</p>

  <p>
    <a href="${eventUrl}"
       style="display:inline-block;background:#27ae60;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold">
      BCPイベントを確認する
    </a>
  </p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999">
    このメールはIntarecoモニタリングシステムから自動送信されています。<br>
    心当たりのない場合は、このメールを無視してください。
  </p>
</body>
</html>
`.trim()

  return { subject, html }
}

// ---------------------------------------------------------------------------

export interface BcpFailedParams {
  storeName: string
  alertType: string
  alertTime: string
  isTest: boolean
}

/**
 * Sent when the BCP recording/upload process has failed.
 */
export function bcpFailedEmail(
  params: BcpFailedParams,
): { subject: string; html: string } {
  const { storeName, alertType, alertTime, isTest } = params
  const testLabel = isTest ? ' TEST' : ''

  const subject = `[BCP失敗${testLabel}] 録画失敗 - ${storeName}`

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  ${isTest ? '<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;border-radius:4px;font-weight:bold">⚠️ これはテスト通知です</p>' : ''}

  <h2 style="color:#e74c3c">❌ BCP録画失敗通知</h2>

  <p style="background:#fdf2f2;border-left:4px solid #e74c3c;padding:12px;border-radius:2px">
    Jアラート発令に伴う録画処理が失敗しました。管理者にご確認ください。
  </p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;width:140px;border:1px solid #ddd">店舗名</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(storeName)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">アラート種別</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertType)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">発令日時</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(alertTime)}</td>
    </tr>
  </table>

  <p>録画クリップが取得できなかった可能性があります。Intarecoモニター管理画面からイベントの詳細をご確認ください。</p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999">
    このメールはIntarecoモニタリングシステムから自動送信されています。<br>
    心当たりのない場合は、このメールを無視してください。
  </p>
</body>
</html>
`.trim()

  return { subject, html }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
