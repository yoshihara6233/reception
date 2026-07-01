'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateAlarmStatus } from '../actions'

/** 発報詳細の確認ワークフロー（未対応→対応中→完了/再開）。 */
export function AlarmDetailActions({ eventId, status }: { eventId: string; status: 'new' | 'ack' | 'closed' }) {
  const router = useRouter()
  const [cur, setCur] = useState(status)
  const [pending, startTransition] = useTransition()

  function set(s: 'new' | 'ack' | 'closed') {
    setCur(s)
    startTransition(async () => { await updateAlarmStatus(eventId, s); router.refresh() })
  }

  const btn = 'rounded px-3 py-1 text-xs font-medium disabled:opacity-50'
  return (
    <div className="flex gap-2">
      {cur !== 'closed' ? (
        <>
          {cur === 'new' && (
            <button disabled={pending} onClick={() => set('ack')}
              className={`${btn} border border-slate-300 text-slate-700 dark:border-gedline dark:text-gedink`}>対応中にする</button>
          )}
          <button disabled={pending} onClick={() => set('closed')}
            className={`${btn} bg-slate-900 text-white dark:bg-gedaccent dark:text-gedbg`}>完了にする</button>
        </>
      ) : (
        <button disabled={pending} onClick={() => set('ack')}
          className={`${btn} border border-slate-300 text-slate-600 dark:border-gedline dark:text-gedink2`}>再開する</button>
      )}
    </div>
  )
}
