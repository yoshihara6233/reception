'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type StoreOption = { id: string; name: string; area_code: string | null }

export function EdgeNewForm({ storeCandidates }: { storeCandidates: StoreOption[] }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState('')
  const [name,    setName]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [result,  setResult]  = useState<{ id: string; device_token: string } | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const res = await fetch('/api/admin/edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, name }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setErr(j.error ?? `登録失敗: ${res.status}`)
    }
    const j = await res.json()
    setResult(j)
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm">
        <h2 className="font-bold text-emerald-900">エッジを登録しました</h2>
        <p className="text-emerald-800">
          現地サーバ <code className="rounded bg-white px-1.5 py-0.5">/etc/edge-agent/agent.env</code> に以下を設定し、エージェントを起動してください。
        </p>
        <pre className="rounded bg-slate-900 p-3 font-mono text-[11px] text-emerald-200 overflow-auto">
{`EDGE_ID=${result.id}
EDGE_DEVICE_TOKEN=${result.device_token}`}
        </pre>
        <p className="text-xs text-emerald-700">
          ⚠ デバイストークンはこの画面でしか表示されません。安全な場所に保管してください。
        </p>
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => router.push(`/admin/edges/${result.id}`)}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white"
          >
            続けてレコーダを登録 →
          </button>
          <button
            onClick={() => router.push('/admin/edges')}
            className="rounded border border-slate-200 bg-white px-4 py-1.5 text-sm"
          >
            一覧に戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">配置する店舗</span>
        <select required value={storeId} onChange={(e) => setStoreId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">— 選択してください —</option>
          {storeCandidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.area_code ? `[${s.area_code}] ` : ''}{s.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-500">
          既にエッジが登録された店舗は選択肢に表示されません（候補 {storeCandidates.length} 件）
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">エッジ名（識別用）</span>
        <input required value={name} onChange={(e) => setName(e.target.value)}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
               placeholder="例: shibuya-minami-edge-01" />
      </label>

      {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="submit" disabled={busy || !storeId || !name}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? '登録中…' : '登録してトークン発行'}
        </button>
      </div>
    </form>
  )
}
