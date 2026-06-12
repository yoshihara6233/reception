'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function UserDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (!confirm(`「${name}」を削除します。元に戻せません。よろしいですか？`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`削除失敗: ${j.error ?? res.status}${j.message ? ` (${j.message})` : ''}`)
      return
    }
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? '削除中…' : '削除'}
    </button>
  )
}
