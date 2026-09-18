'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Upload } from 'lucide-react'

interface Release {
  id: string
  version: string
  sha256: string
  bytes: number
  notes: string | null
  created_at: string
}
interface EdgeRow {
  id: string
  name: string
  agent_version: string | null
  desired_agent_version: string | null
  update_force: boolean
  stores: { name: string } | null
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.ceil(n / 1024)} KB`
}

export function ReleasesClient({ releases, edges }: { releases: Release[]; edges: EdgeRow[] }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [sigFile, setSigFile] = useState<File | null>(null)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function register() {
    if (!file || !sigFile || !version.trim()) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const v = version.trim()
      // 1) アップロード先を取得（Vercel の本文上限を避け Storage へ直接 PUT）
      const r1 = await fetch('/api/admin/nvmsd-releases/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: v, bytes: file.size }),
      })
      const j1 = await r1.json().catch(() => ({}))
      if (!r1.ok) throw new Error(j1.error === 'version_exists' ? 'このバージョンは登録済みです' : (j1.error ?? `upload-url ${r1.status}`))

      // 2) バイナリを直接 PUT
      setMsg('アップロード中…')
      const r2 = await fetch(j1.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: file,
      })
      if (!r2.ok) throw new Error(`アップロード失敗: ${r2.status}`)

      // 3) 署名（base64 テキスト）と共に台帳登録 — sha256 はサーバが実体から計算
      setMsg('登録中（チェックサム計算）…')
      const sig = (await sigFile.text()).trim()
      const r3 = await fetch('/api/admin/nvmsd-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: v, sig, notes: notes.trim() || undefined }),
      })
      const j3 = await r3.json().catch(() => ({}))
      if (!r3.ok) throw new Error(j3.error === 'version_exists' ? 'このバージョンは登録済みです' : (j3.error ?? `登録失敗 ${r3.status}`))

      setMsg(`登録しました: ${v}（SHA-256 ${String(j3.sha256).slice(0, 12)}…）`)
      setFile(null); setSigFile(null); setVersion(''); setNotes('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setMsg(null)
    } finally {
      setBusy(false)
    }
  }

  async function remove(rel: Release) {
    if (!confirm(`リリース ${rel.version} を取り下げますか？\n（どこかのエッジが目標版にしている間は消せません）`)) return
    const res = await fetch(`/api/admin/nvmsd-releases/${rel.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(j.error === 'in_use' ? `${j.edges} 台のエッジが目標版として参照中のため取り下げられません` : (j.error ?? `削除失敗: ${res.status}`))
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* 登録フォーム */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-1 font-bold text-slate-900">リリース登録</h2>
        <p className="mb-3 text-xs text-slate-500">
          G・VMS がビルドし <b>G・VMS の鍵で署名した</b>リリースを登録します（クラウドは配送路 —
          正当性の検証は nvmsd が埋め込み公開鍵で行います）。SHA-256 はアップロード実体からサーバが計算します。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">バイナリ（nvmsd-&lt;version&gt;-linux-*）</span>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                   className="block w-full text-xs" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">署名ファイル（.sig・base64）</span>
            <input type="file" accept=".sig,.txt" onChange={(e) => setSigFile(e.target.files?.[0] ?? null)}
                   className="block w-full text-xs" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">バージョン</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)}
                   className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                   placeholder="例: 0.1.56-abc1234" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">メモ（任意）</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
                   className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                   placeholder="例: 診断案B対応・荷捌き場で検証済み" />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {err && <span className="mr-auto text-xs text-red-700">{err}</span>}
          {msg && !err && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
          <button onClick={register} disabled={busy || !file || !sigFile || !version.trim()}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            <Upload size={14} strokeWidth={1.5} aria-hidden /> {busy ? '処理中…' : '登録'}
          </button>
        </div>
      </section>

      {/* 台帳 */}
      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <h2 className="border-b border-slate-100 px-5 py-3 font-bold text-slate-900">登録済みリリース</h2>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">バージョン</th>
              <th className="px-4 py-2 text-left">SHA-256</th>
              <th className="px-4 py-2 text-right">サイズ</th>
              <th className="px-4 py-2 text-left">メモ</th>
              <th className="px-4 py-2 text-left">登録日時</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono font-medium">{r.version}</td>
                <td className="px-4 py-2 font-mono text-slate-500">{r.sha256.slice(0, 16)}…</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtBytes(r.bytes)}</td>
                <td className="px-4 py-2 text-slate-600">{r.notes ?? '—'}</td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => remove(r)}
                          className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50">
                    <Trash2 size={12} strokeWidth={1.5} aria-hidden /> 取り下げ
                  </button>
                </td>
              </tr>
            ))}
            {releases.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">リリースはまだ登録されていません</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* 配備状況（nvmsd アップリンクのみ） */}
      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <div className="flex items-baseline gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="font-bold text-slate-900">配備状況</h2>
          <span className="text-[11px] text-slate-400">目標版の設定は各エッジの詳細ページから（検証拠点 → 全体の段階配備）</span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">エッジ</th>
              <th className="px-4 py-2 text-left">店舗</th>
              <th className="px-4 py-2 text-left">稼働版</th>
              <th className="px-4 py-2 text-left">目標版</th>
              <th className="px-4 py-2 text-left">状態</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e) => {
              const running = (e.agent_version ?? '').replace(/^nvmsd\//, '')
              const state = !e.desired_agent_version
                ? { label: '指示なし', cls: 'bg-slate-100 text-slate-500' }
                : running === e.desired_agent_version
                  ? { label: '一致', cls: 'bg-emerald-100 text-emerald-700' }
                  : { label: e.update_force ? '即時更新待ち' : '更新待ち（時間帯内に適用）', cls: 'bg-amber-100 text-amber-700' }
              return (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <a href={`/admin/edges/${e.id}`} className="text-blue-600 hover:underline">{e.name}</a>
                  </td>
                  <td className="px-4 py-2">{e.stores?.name ?? '—'}</td>
                  <td className="px-4 py-2 font-mono">{running || '—'}</td>
                  <td className="px-4 py-2 font-mono">{e.desired_agent_version ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + state.cls}>{state.label}</span>
                  </td>
                </tr>
              )
            })}
            {edges.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">nvmsd アップリンクのエッジがまだありません</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
