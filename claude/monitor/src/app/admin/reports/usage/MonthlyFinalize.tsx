'use client'

/**
 * 月次確定ボタン（C）。表示中の月を確定（スナップショット＋PDF）する。
 * super_admin / tenant_admin のみ。確定後はページを更新して一覧に反映。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function MonthlyFinalize({ ym, monthLabel }: { ym: string; monthLabel: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function finalize() {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/admin/reports/monthly', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ym }),
    })
    setBusy(false)
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setMsg({ ok: true, text: `${monthLabel}を確定しました（${j.storeCount ?? 0} 店舗）` })
      router.refresh()
    } else {
      setMsg({ ok: false, text: j.error === 'tenant_required' ? 'テナントを選択してください' : `確定に失敗: ${j.error ?? res.status}` })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={finalize} disabled={busy}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? '確定中…' : `${monthLabel}を確定（PDF作成）`}
      </button>
      {msg && <span className={msg.ok ? 'text-[11px] text-emerald-600' : 'text-[11px] text-red-600'}>{msg.text}</span>}
    </div>
  )
}
