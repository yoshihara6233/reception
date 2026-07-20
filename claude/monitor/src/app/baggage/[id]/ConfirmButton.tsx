'use client'

/**
 * 「再生して確認」ボタン（M4・D8: 店長の再生確認）。
 * confirmed_by / confirmed_at を記録し、履歴一覧の「未確認」バッジを消す。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ConfirmButton(
  { sessionId, confirmed, disabled = false }:
  { sessionId: string; confirmed: boolean; disabled?: boolean },
) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(confirmed)

  if (done) {
    return <span className="text-[12px] text-emerald-700 dark:text-emerald-400">確認済み</span>
  }
  return (
    <button
      disabled={busy || disabled}
      title={disabled ? '映像を最後まで再生してから確認できます' : undefined}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch(`/api/baggage/sessions/${sessionId}/confirm`, { method: 'POST' })
          if (res.ok) { setDone(true); router.refresh() }
        } finally {
          setBusy(false)
        }
      }}
      className="rounded bg-blue-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-800 disabled:opacity-40 dark:bg-gedaccent"
    >
      {busy ? '記録中…' : '確認済みにする'}
    </button>
  )
}
