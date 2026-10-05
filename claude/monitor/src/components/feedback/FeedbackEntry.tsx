'use client'

/**
 * 画面右上の「要望・困りごと」（基本設計 §3.1）。
 *
 * 出すかどうかはサーバで決める（resolveFeedbackEntry: テナント管理者だけ・テナントが止めていないとき）。
 * ここは押されたら入力を開くだけ。アイコンだけのボタンにしない（文字の名前を付ける）。
 */
import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { FeedbackDialog } from './FeedbackDialog'

export function FeedbackEntry() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="要望・困りごとを運営へ送る"
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <MessageSquarePlus size={16} strokeWidth={1.5} aria-hidden />
        <span className="hidden xl:inline">要望・困りごと</span>
        <span className="xl:hidden">要望</span>
      </button>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
