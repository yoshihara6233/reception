import { describe, it, expect, beforeEach } from 'vitest'
import {
  sendEmail, passwordResetEmail, SECURITY_FROM_ADDRESS,
  bcpAlertStartedEmail, bcpCompletedEmail, bcpFailedEmail,
} from './send'

// First monitor unit tests — establishes the vitest harness + CI test step.
// Pure/early-return paths only (no network): broader coverage lands with the
// staging-DB integration suite (Phase A).

describe('passwordResetEmail', () => {
  it('escapes HTML-significant chars in the reset URL', () => {
    const url = 'https://intereco-monitor.vercel.app/reset-password?email=a%40b.com&token=x"y<z'
    const { html } = passwordResetEmail(url)
    // raw dangerous chars must not appear unescaped inside the html
    expect(html).not.toContain('"y<z')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;')
    expect(html).toContain('&quot;')
  })

  it('includes the one-time / 1h expiry notice and a subject', () => {
    const { subject, html } = passwordResetEmail('https://example.com/reset-password')
    expect(subject).toMatch(/パスワード/)
    expect(html).toContain('1時間')
    expect(html).toContain('一度のみ')
  })

  it('security sender uses a domain we own and can verify in Resend', () => {
    expect(SECURITY_FROM_ADDRESS).toContain('@genesis-edge.com')
  })
})

describe('sendEmail', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY
  })

  it('returns {ok:false} without making a request when RESEND_API_KEY is unset', async () => {
    const res = await sendEmail('a@b.com', 'subj', '<p>body</p>')
    expect(res).toEqual({ ok: false })
  })
})

// 2026-11-05: BCP のメールの件名と本文に内部名 (earthquake) が出ていた。
// 種別は画面・PDF と同じ表示名にし、件名の先頭 (受け手の振り分けに使う部分) は変えない。
describe('BCP のメールの種別', () => {
  const base = { storeName: '本店', alertTime: '2026/11/05 10:00', eventUrl: 'https://example.com/bcp/x', isTest: false }

  it('発令のメール: 件名の括弧と本文が日本語・先頭の決まった部分は変わらない', () => {
    const { subject, html } = bcpAlertStartedEmail({ ...base, alertType: 'earthquake' })
    expect(subject).toBe('[BCP] Jアラート発令 - 本店 (震度情報)')
    expect(subject).not.toContain('earthquake')
    expect(html).toContain('震度情報')
    expect(html).not.toContain('earthquake')
  })

  it('テストの発令: 先頭は [BCP TEST] のまま・特別警報も日本語', () => {
    const { subject } = bcpAlertStartedEmail({ ...base, isTest: true, alertType: 'special_warning' })
    expect(subject).toBe('[BCP TEST] Jアラート発令 - 本店 (特別警報)')
  })

  it('完了のメール: 件名はそのまま・本文の種別が日本語', () => {
    const { subject, html } = bcpCompletedEmail({ ...base, alertType: 'earthquake', clipCount: 3 })
    expect(subject).toBe('[BCP完了] 録画・報告書 - 本店')
    expect(html).toContain('震度情報')
    expect(html).not.toContain('earthquake')
  })

  it('失敗のメール: 本文の種別が日本語', () => {
    const { subject, html } = bcpFailedEmail({ ...base, alertType: 'earthquake' })
    expect(subject).toBe('[BCP失敗] 録画失敗 - 本店')
    expect(html).toContain('震度情報')
    expect(html).not.toContain('earthquake')
  })

  it('知らない種別・日本語で渡された種別はそのまま出す', () => {
    expect(bcpAlertStartedEmail({ ...base, alertType: '震度情報' }).subject).toContain('(震度情報)')
    expect(bcpAlertStartedEmail({ ...base, alertType: 'unknown_x' }).subject).toContain('(unknown_x)')
  })
})
