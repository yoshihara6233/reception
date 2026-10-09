import { describe, expect, it } from 'vitest'
import { feedbackRecipients } from './recipients'

describe('feedbackRecipients', () => {
  it('FEEDBACK_EMAILS を優先し、無ければ ALERT_EMAILS', () => {
    expect(feedbackRecipients({ FEEDBACK_EMAILS: 'a@x, b@x', ALERT_EMAILS: 'ops@x' }))
      .toEqual({ emails: ['a@x', 'b@x'], source: 'FEEDBACK_EMAILS' })
    expect(feedbackRecipients({ FEEDBACK_EMAILS: ' ', ALERT_EMAILS: 'ops@x' }))
      .toEqual({ emails: ['ops@x'], source: 'ALERT_EMAILS' })
    expect(feedbackRecipients({})).toEqual({ emails: [], source: 'none' })
  })
})
