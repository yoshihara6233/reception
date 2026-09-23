'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, ShieldCheck } from 'lucide-react'

export interface EdgeOpt { id: string; name: string; store: string; mac: string | null; cameras: number }
export interface LicRow {
  id: string; edgeId: string; edge: string; store: string
  org: string | null; maxCameras: number | null; cameras: number
  expiresAt: string | null; boundMac: string | null; version: number; status: 'active' | 'revoked'
}

function expiryState(d: string | null): { cls: string; label: string } {
  if (!d) return { cls: '', label: '—' }
  const days = Math.floor((new Date(d + 'T23:59:59+09:00').getTime() - Date.now()) / 86400000)
  if (days < 0) return { cls: 'ex', label: `期限切れ（${d}）` }
  if (days <= 30) return { cls: 'soon', label: `${d}（あと ${days} 日）` }
  return { cls: '', label: d }
}

export function LicensesClient({ edges, rows, canIssue }: { edges: EdgeOpt[]; rows: LicRow[]; canIssue: boolean }) {
  const router = useRouter()
  const [edgeId, setEdgeId] = useState('')
  const [org, setOrg] = useState('')
  const [maxCam, setMaxCam] = useState('')
  const [expires, setExpires] = useState('')
  const [mac, setMac] = useState('')
  const [notes, setNotes] = useState('')
  const [blob, setBlob] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const sel = edges.find((e) => e.id === edgeId)

  async function submit() {
    if (!edgeId || !blob.trim()) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const res = await fetch('/api/admin/licenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edge_id: edgeId, license_blob: blob.trim(),
          org_name: org.trim() || null,
          max_cameras: maxCam.trim() ? Number(maxCam) : null,
          expires_at: expires || null,
          bound_mac: mac.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error === 'active_license_exists' ? '有効なライセンスが既にあります（差し替えは自動で行われます・再実行してください）' : (j.error ?? `登録失敗: ${res.status}`))
      setMsg('登録しました（次回取得で拠点へ反映）')
      setBlob(''); setNotes('')
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function revoke(r: LicRow) {
    if (!confirm(`${r.org ?? r.edge} のライセンスを失効しますか？\n次回取得で拠点は権利を失います（録画は継続・追加/上位機能が停止）。`)) return
    const res = await fetch(`/api/admin/licenses/${r.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { alert(j.error ?? `失効失敗: ${res.status}`); return }
    router.refresh()
  }

  return (
    <div className="space-y-5" style={{ ['--ok' as string]: '#2F7A4F', ['--warn' as string]: '#B5761A', ['--danger' as string]: '#A3332B' }}>
      {/* 発行/差し替え */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-1 font-bold text-slate-900">ライセンスの登録・差し替え</h2>
        <p className="mb-3 text-xs text-slate-500">
          G・VMS が<b>署名したライセンス</b>を登録します（クラウドは配送路 — 正当性は nvmsd が埋め込み公開鍵で検証）。
          機器の MAC を G・VMS に伝えて署名を受け、その文字列をここに貼り付けてください。
        </p>
        {!canIssue && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            操作中テナントを選択すると登録できます（上部の「切替」から）。
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs md:col-span-1">
            <span className="mb-1 block font-medium text-slate-600">対象エッジ（拠点）</span>
            <select value={edgeId} onChange={(e) => { setEdgeId(e.target.value); const x = edges.find((v) => v.id === e.target.value); if (x?.mac) setMac(x.mac) }}
                    disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="">— 選択 —</option>
              {edges.map((e) => <option key={e.id} value={e.id}>{e.store} / {e.name}</option>)}
            </select>
            {sel && (
              <p className="mt-1 text-[10px] text-slate-500">
                現在カメラ {sel.cameras.toLocaleString()} 台 ・ MAC: <span className="font-mono">{sel.mac ?? '未申告（nvmsd の対応版待ち）'}</span>
              </p>
            )}
          </label>
          <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">発行先組織</span>
            <input value={org} onChange={(e) => setOrg(e.target.value)} disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder="例: ◯◯ドラッグ" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">最大カメラ台数</span>
              <input value={maxCam} onChange={(e) => setMaxCam(e.target.value.replace(/[^0-9]/g, ''))} disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" placeholder="例: 100" /></label>
            <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">有効期限</span>
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" /></label>
          </div>
          <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">束縛 MAC（署名対象・任意記録）</span>
            <input value={mac} onChange={(e) => setMac(e.target.value)} disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" placeholder="エッジ選択で自動入力" /></label>
          <label className="block text-xs md:col-span-2"><span className="mb-1 block font-medium text-slate-600">メモ（任意）</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canIssue} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" /></label>
        </div>
        <label className="mt-3 block text-xs">
          <span className="mb-1 block font-medium text-slate-600">ライセンス（G・VMS 署名済み文字列をそのまま貼り付け）</span>
          <textarea value={blob} onChange={(e) => setBlob(e.target.value)} disabled={!canIssue} rows={3}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-[11px]" placeholder="nvmslic1.… など（中身はクラウドで解釈しません）" />
        </label>
        <div className="mt-3 flex items-center justify-end gap-3">
          {err && <span className="mr-auto text-xs text-red-700">{err}</span>}
          {msg && !err && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
          <button onClick={submit} disabled={busy || !canIssue || !edgeId || !blob.trim()}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            <ShieldCheck size={14} strokeWidth={1.5} aria-hidden /> {busy ? '登録中…' : '登録 / 差し替え'}
          </button>
        </div>
      </section>

      {/* 台帳 */}
      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <h2 className="border-b border-slate-100 px-5 py-3 font-bold text-slate-900">ライセンス台帳</h2>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">まだありません。上で登録してください。</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">発行先 / 拠点</th>
                <th className="px-4 py-2 text-right">台数（現在/上限）</th>
                <th className="px-4 py-2 text-left">有効期限</th>
                <th className="px-4 py-2 text-left">版/状態</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ex = expiryState(r.expiresAt)
                const over = r.maxCameras != null && r.cameras > r.maxCameras
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{r.org ?? '（組織未設定）'}</div><div className="text-slate-400">{r.store} / {r.edge}</div></td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      <span className={over ? 'font-bold text-red-700' : ''}>{r.cameras.toLocaleString()}</span> / {r.maxCameras != null ? r.maxCameras.toLocaleString() : '—'}
                      {over && <div className="text-[10px] text-red-700">上限超過</div>}
                    </td>
                    <td className={'px-4 py-2.5 ' + (ex.cls === 'ex' ? 'text-red-700 font-semibold' : ex.cls === 'soon' ? 'text-amber-700' : 'text-slate-600')}>{ex.label}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono">v{r.version}</span>{' '}
                      <span className={'ml-1 rounded px-2 py-0.5 text-[11px] font-semibold ' + (r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500')}>
                        {r.status === 'active' ? '有効' : '失効'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'active' && (
                        <button onClick={() => revoke(r)} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50">
                          <Trash2 size={12} strokeWidth={1.5} aria-hidden /> 失効
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-slate-400">
        期限切れでも録画は継続し、追加・上位機能が停止します（LICENSE_SPEC §5）。クラウド断でも直近の有効ライセンスで動作します（オフライン猶予）。
      </p>
    </div>
  )
}
