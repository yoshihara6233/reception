'use client'

/** 設定の「要望」の画面から入力を開くボタン。送ったら一覧を読み直す。 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FeedbackDialog } from './FeedbackDialog'

export function FeedbackSendButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded bg-ge-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-ge-ink-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg"
      >
        要望・困りごとを送る
      </button>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} onSent={() => router.refresh()} />
    </>
  )
}
