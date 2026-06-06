'use client'

import { useState } from 'react'

interface Result {
  total: number
  ok:    number
  error: number
  results: { row: number; ok: boolean; id?: string; error?: string }[]
}

export function ImportForm({
  kind,
  title,
  endpoint,
  help,
  example,
}: {
  kind: string
  title: string
  endpoint: string
  help: React.ReactNode
  example: string
}) {
  const [text, setText]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [res,  setRes]    = useState<Result | null>(null)
  const [err,  setErr]    = useState<string | null>(null)

  async function onFile(file: File) {
    const t = await file.text()
    setText(t)
  }

  async function submit() {
    if (!text.trim()) return
    setBusy(true); setErr(null); setRes(null)
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text })
    setBusy(false)
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      return setErr(j.error ?? `投入失敗: ${r.status}`)
    }
    setRes(await r.json())
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <h2 className="font-bold text-slate-900">{title}</h2>
      <div className="mt-1 text-[11px] text-slate-500">{help}</div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <input type="file" accept=".csv,text/csv"
               onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button onClick={() => setText(example)} className="rounded border border-slate-200 px-2 py-0.5">
          サンプル挿入
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="mt-2 w-full rounded border border-slate-200 p-2 font-mono text-[11px]"
        placeholder={`CSV をここに貼り付け、または上からファイル選択`}
      />

      {err && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      {res && (
        <div className="mt-3 rounded bg-slate-50 p-3 text-xs">
          <div className="mb-2">
            合計 <b>{res.total}</b> 件 / 成功 <b className="text-emerald-700">{res.ok}</b> / 失敗 <b className="text-red-700">{res.error}</b>
          </div>
          {res.error > 0 && (
            <ul className="max-h-40 overflow-auto text-[11px] text-red-700">
              {res.results.filter((r) => !r.ok).slice(0, 50).map((r) => (
                <li key={r.row}>行 {r.row}: {r.error}</li>
              ))}
              {res.results.filter((r) => !r.ok).length > 50 && <li>… 他</li>}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button onClick={submit} disabled={busy || !text.trim()}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {busy ? '投入中…' : `${kind} を投入`}
        </button>
      </div>
    </section>
  )
}
