/**
 * 要望に添えた「該当の画面の URL」と画像の表示（GVMS_CLOUD_SPEC §12.2・§12.6）。
 * テナント管理者の一覧（/settings/feedback）と運営の要望ボード（/admin/feedback）で使う。
 *
 * 画像は imageHref（期限つきの URL へ 302 する API）を <img> と「開く」（新しいタブ）の両方に使う。
 * 期限つきの URL はその都度 API が作るので、画面を開いたままでも切れない。
 * URL は文として出す（拠点の G・VMS の画面の場所なので、クラウドからはリンクにしない）。
 */
import { ExternalLink } from 'lucide-react'
import type { AttachmentState } from '@/lib/feedback/board'

const muted = 'text-ge-ink-3 dark:text-gedink3'

export function FeedbackAttachment({
  pageUrl, state, imageHref,
}: {
  pageUrl: string | null
  state: AttachmentState
  /** state=stored のときの画像の API（例 /api/feedback/<id>/attachment） */
  imageHref: string
}) {
  if (!pageUrl && state === 'none') return null
  return (
    <div className="mt-2 space-y-1.5 text-[11px]">
      {pageUrl && (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`shrink-0 ${muted}`}>該当の画面</span>
          <span className="min-w-0 break-all font-ge-mono">{pageUrl}</span>
        </div>
      )}
      {state === 'stored' && (
        <div className="flex items-end gap-3">
          <a href={imageHref} target="_blank" rel="noopener noreferrer" className="block shrink-0" title="添えた画像を新しいタブで開く">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageHref}
              alt="添えた画像の見本"
              loading="lazy"
              className="h-20 w-auto max-w-[10rem] rounded border border-ge-line bg-ge-paper object-contain dark:border-gedline dark:bg-gedbg"
            />
          </a>
          <a href={imageHref} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 underline ${muted}`}>
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            画像を開く
          </a>
        </div>
      )}
      {state === 'pending' && <p className={muted}>画像: 拠点からまだ届いていません</p>}
      {state === 'purged' && <p className={muted}>画像: 保存期間（1 年）を過ぎたため消しました</p>}
    </div>
  )
}
