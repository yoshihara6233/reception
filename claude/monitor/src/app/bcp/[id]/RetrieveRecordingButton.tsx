'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 「現地レコーダの録画を取得」ボタン。
 * POST /api/bcp/[id]/retrieve でエッジに撮影指令を発行し、8枚スナップを取得する。
 * 取得は数分かかるため、成功後はページを更新してステータス(録画中)を反映する。
 */
export function RetrieveRecordingButton({ eventId, alreadyHasClips }: { eventId: string; alreadyHasClips: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  function retrieve() {
    setErr(''); setMsg('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/bcp/${eventId}/retrieve`, { method: 'POST' })
        const json = await res.json().catch(() => ({}))
        if (res.ok) {
          setMsg(`取得を開始しました（${json.cameras ?? 0}カメラ）。数分後にスナップショットが表示されます。`)
          router.refresh()
        } else {
          setErr(json.message ?? json.error ?? '取得に失敗しました')
        }
      } catch {
        setErr('通信に失敗しました')
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={retrieve}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          {pending ? '取得指令を送信中…' : alreadyHasClips ? '現地レコーダの録画を再取得' : '現地レコーダの録画を取得'}
        </button>
        {msg && <span className="text-[11px] text-emerald-700">{msg}</span>}
        {err && <span className="text-[11px] text-red-600">{err}</span>}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        発令時刻の前後（既定 −3分〜+5分）の映像を、現地レコーダから8枚スナップショットとして取得します。
        災害時は回線が混み合うため、回線が落ち着いてからの取得を推奨します。取得完了後、PDFは自動生成されます。
      </p>
    </div>
  )
}
