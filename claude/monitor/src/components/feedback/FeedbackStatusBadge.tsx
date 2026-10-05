import { STATUS_LABEL, type FeedbackStatus } from '@/lib/feedback/schema'

/**
 * 要望の状態の札（基本設計 §3.6 の表示）。藍は使わない（画面の藍は 2〜3 要素までの決まり）。
 * 対応しました = 成功色、それ以外は墨の濃淡で分ける。
 */
export function FeedbackStatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status as FeedbackStatus] ?? STATUS_LABEL.reviewing
  const cls =
    status === 'done'
      ? 'border-ge-success text-ge-success dark:border-ge-success dark:text-ge-success'
      : status === 'received'
        ? 'border-ge-line-2 text-ge-ink-2 dark:border-gedline dark:text-gedink2'
        : status === 'declined'
          ? 'border-ge-line text-ge-ink-3 dark:border-gedline dark:text-gedink3'
          : 'border-ge-ink-2 text-ge-ink dark:border-gedink2 dark:text-gedink'
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  )
}
