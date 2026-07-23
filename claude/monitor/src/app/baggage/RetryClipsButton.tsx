'use client'

/**
 * 「映像を再取得」ボタン（手動再取得）。
 * 「処理中」のまま自動リトライが通らない / 取得失敗の検査で、店長が今すぐ
 * 切り出しジョブを再投入する。完了(clipDone>=clipTotal>0)の検査では出さない。
 */
import { useState } from 'react'

export function RetryClipsButton(
  { sessionId, clipTotal, clipDone, onRequeued }:
  { sessionId: string; clipTotal: number; clipDone: number; onRequeued?: () => void },
) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // ジョブが有り、かつ全数 done なら再取得不要 → 非表示。
  if (clipTotal > 0 && clipDone >= clipTotal) return null

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setMsg(null)
          try {
            const res = await fetch(`/api/baggage/sessions/${sessionId}/clips/retry`, { method: 'POST' })
            const j = await res.json().catch(() => null) as { ok?: boolean; requeued?: number; created?: number; error?: string } | null
            if (res.ok && j?.ok) {
              const n = (j.requeued ?? 0) + (j.created ?? 0)
              setMsg(n > 0 ? `${n}件のカメラを再取得します（数分後に反映）` : '再取得の対象がありませんでした')
              onRequeued?.()
            } else {
              setMsg(`再取得できませんでした（${j?.error ?? res.status}）`)
            }
          } catch {
            setMsg('通信に失敗しました。もう一度お試しください。')
          } finally {
            setBusy(false)
          }
        }}
        className="rounded border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg3"
      >
        {busy ? '再取得を要求中…' : '映像を再取得'}
      </button>
      {msg && <span className="text-[12px] text-slate-500 dark:text-gedink3">{msg}</span>}
    </div>
  )
}
