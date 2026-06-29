/**
 * F60: BCP 詳細ページ「PDF を生成」ボタン (Client Component)
 *
 * POST /api/bcp/[id]/generate-report を呼び出し、PDF を生成 → Storage アップロード
 * → bcp_reports 更新までを行う。成功したらページをリロードして PDF ダウンロード
 * ボタンを表示。
 */
'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileText } from 'lucide-react'

interface Props {
  eventId:      string
  isDisabled?:  boolean
  hintMessage?: string
  buttonLabel?: ReactNode
}

export function GenerateReportButton({ eventId, isDisabled, hintMessage, buttonLabel }: Props) {
  const [message, setMessage]   = useState<ReactNode | null>(null)
  const [error,   setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  async function handleClick() {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/bcp/${eventId}/generate-report`, {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
        })
        const json = await res.json()
        if (!res.ok || !json?.ok) {
          // Show actual error message from API + status
          const parts = [`HTTP ${res.status} ${json?.error ?? '(no error code)'}`]
          if (json?.message) parts.push(json.message)
          setError(parts.join(' — '))
          // Log full payload for deeper debugging via console
          console.error('[GenerateReportButton] API error:', json)
          return
        }
        setMessage(
          <>
            <Check size={13} strokeWidth={2} aria-hidden /> PDF を生成しました ({json.snapshotCount ?? '?'} 枚使用)
          </>,
        )
        // refresh server component to show download button
        router.refresh()
      } catch (e) {
        setError(String((e as Error).message ?? e))
      }
    })
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleClick}
          disabled={isDisabled || pending}
          className={
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition ' +
            (isDisabled || pending
              ? 'cursor-not-allowed bg-slate-200 text-slate-500'
              : 'bg-indigo-600 text-white hover:bg-indigo-700')
          }
        >
          {pending ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              生成中…
            </>
          ) : (
            <>{buttonLabel ?? <><FileText size={13} strokeWidth={1.5} aria-hidden /> PDF を生成</>}</>
          )}
        </button>
        {hintMessage && (
          <span className="text-[11px] text-slate-500">{hintMessage}</span>
        )}
      </div>
      {message && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-600">{message}</p>
      )}
      {error && (
        <p className="text-xs text-red-600">エラー: {error}</p>
      )}
    </div>
  )
}
