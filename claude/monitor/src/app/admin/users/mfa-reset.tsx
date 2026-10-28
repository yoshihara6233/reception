'use client'

/**
 * 利用者の多要素認証を外す（管理者・端末の紛失など・2026-10-28）。
 * 利用者の編集画面（テナントの利用者・運営の利用者）に置く。
 */
import { useEffect, useState } from 'react'

export function MfaResetSection({ id, name }: { id: string; name: string }) {
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/users/${id}/mfa-reset`).then((r) => r.ok ? r.json() : null)
      .then((j) => setCount(j ? j.factors : null)).catch(() => setCount(null))
  }, [id])

  async function onReset() {
    if (!confirm(`「${name}」の多要素認証を外します。端末を無くしたなどの申し出があったとき、本人であることを確かめてから行ってください。外しますか？`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/users/${id}/mfa-reset`, { method: 'POST' })
    setBusy(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(`外せませんでした: ${j.error ?? res.status}`); return }
    setCount(0)
    setMsg('外しました。次のログインからパスワードだけで入れます。')
  }

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">多要素認証</h2>
      <p className="text-xs text-slate-600">
        {count === null ? '確かめています…' : count > 0 ? `使っています（認証アプリ ${count} 件）` : '使っていません'}
      </p>
      {count !== null && count > 0 && (
        <button type="button" onClick={onReset} disabled={busy}
                className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
          {busy ? '外しています…' : '多要素を外す'}
        </button>
      )}
      {msg && <p className="text-xs text-slate-700">{msg}</p>}
    </section>
  )
}
