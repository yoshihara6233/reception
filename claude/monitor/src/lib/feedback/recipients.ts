/**
 * 要望の知らせ (新着のまとめ・業務が止まる要望) の宛先。
 *
 * **要望の知らせは FEEDBACK_EMAILS (カンマ区切り) へ送る。** 未設定なら、これまでどおり
 * 運用アラートの ALERT_EMAILS へ送る (2026-10-09)。
 *
 * 以前は運用アラートと同じ ALERT_EMAILS へ送っていた。運用アラートは開発の宛先へ
 * 向けて早い時期に設定されたもので、要望は会社の窓口 (INFO) で受けたいのに届かなかった
 * (10/9 のまとめメールが INFO に来なかった)。宛先を分け、窓口だけを足せるようにする。
 */
export type FeedbackRecipients = {
  emails: string[]
  /** どの設定から取ったか (ログ用・宛先そのものはログに出さない) */
  source: 'FEEDBACK_EMAILS' | 'ALERT_EMAILS' | 'none'
}

const split = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function feedbackRecipients(env: Record<string, string | undefined> = process.env): FeedbackRecipients {
  const own = split(env.FEEDBACK_EMAILS)
  if (own.length) return { emails: own, source: 'FEEDBACK_EMAILS' }
  const ops = split(env.ALERT_EMAILS)
  if (ops.length) return { emails: ops, source: 'ALERT_EMAILS' }
  return { emails: [], source: 'none' }
}
