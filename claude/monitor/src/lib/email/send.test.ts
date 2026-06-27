import { describe, it, expect, beforeEach } from 'vitest'
import { sendEmail, passwordResetEmail, SECURITY_FROM_ADDRESS } from './send'

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
