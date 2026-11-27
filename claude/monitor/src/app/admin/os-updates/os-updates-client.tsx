'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Trash2, Upload } from 'lucide-react'
import { askConfirm } from '@/components/ConfirmDialog'

export interface OsUpdateFileRow {
  id: string
  file_id: string
  title: string
  advisory: string | null
  cve: string | null
  issued_at: string | null
  packages: { name: string; at_least: string }[]
  reboot: boolean
  notes: string | null
  created_at: string
  withdrawn_at: string | null
}
export interface OsUpdateEdgeRow {
  id: string
  name: string
  store: string | null
  tenant: string | null
  version: string
  /** os_update を名乗っている（G・VMS 1.0.0 以降）＝受け取れる */
  capable: boolean
  urgent: number
  routine: number
  /** 今この拠点へ届けているファイル（os_update_files.id） */
  fileId: string | null
}

const REGISTER_ERRORS: Record<string, string> = {
  too_large: 'ファイルが大きすぎます（64 KiB まで）。',
  bad_format: 'OS 更新ファイルの形ではありません（nvmsosu1. で始まる 1 行）。',
  bad_body: '本文を読めません。ファイルが壊れているか、途中で切れています。',
  bad_id: '本文の番号（id）が正しくありません。',
  no_title: '本文に題がありません。',
  bad_packages: '本文の部品の一覧が正しくありません。',
  bad_signature: '署名が合いません。当社の鍵で署名したファイルか確かめてください。',
  file_exists: '同じ番号のファイルは登録済みです。',
  invalid_body: '入力を確かめてください。',
}
const DELIVER_ERRORS: Record<string, string> = {
  not_capable: '受け取れない拠点（G・VMS 1.0.0 より前）が含まれています。',
  unknown_edge: '一覧に無い拠点が含まれています。画面を読み込み直してください。',
  withdrawn: '取り下げたファイルは届けられません。',
}

const fmtTime = (s: string) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

export function OsUpdatesClient({ files, edges }: { files: OsUpdateFileRow[]; edges: OsUpdateEdgeRow[] }) {
  const router = useRouter()
  const [signed, setSigned] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** 届け先を選んでいるファイル */
  const [openId, setOpenId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const deliveredCount = (id: string) => edges.filter((e) => e.fileId === id).length
  const capableCount = edges.filter((e) => e.capable).length

  async function loadFile(f: File | null) {
    if (!f) return
    setSigned((await f.text()).trim())
  }

  async function register() {
    if (!signed.trim()) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const res = await fetch('/api/admin/os-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signed: signed.trim(), notes: notes.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(REGISTER_ERRORS[j.error] ?? `登録できませんでした（${j.error ?? res.status}）`)
      setMsg(`登録しました: ${j.file_id}${j.signature_checked ? '（署名を確認済み）' : '（署名は拠点が確かめます）'}。届ける拠点を下で選んでください。`)
      setSigned(''); setNotes('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function open(f: OsUpdateFileRow) {
    if (openId === f.id) { setOpenId(null); return }
    setOpenId(f.id)
    setPicked(new Set(edges.filter((e) => e.fileId === f.id).map((e) => e.id)))
  }
  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function deliver(f: OsUpdateFileRow) {
    const replaced = edges.filter((e) => picked.has(e.id) && e.fileId && e.fileId !== f.id).length
    const text = `${f.file_id} を ${picked.size.toLocaleString('ja-JP')} 拠点へ届けます。\n` +
      '拠点は 10 分以内に受け取り、画面の「OS の更新」に出します。届いても当たりません（始めるのは拠点の管理者です）。' +
      (replaced > 0 ? `\n\n${replaced.toLocaleString('ja-JP')} 拠点は、今届けている別のファイルから替わります。` : '')
    if (!(await askConfirm(text, { confirmLabel: '届ける' }))) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch(`/api/admin/os-updates/${f.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edge_ids: [...picked] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(DELIVER_ERRORS[j.error] ?? `届け先を保存できませんでした（${j.error ?? res.status}）`)
      setMsg(`${f.file_id} の届け先を保存しました（届ける拠点 ${Number(j.total).toLocaleString('ja-JP')}・追加 ${Number(j.added).toLocaleString('ja-JP')}・外した拠点 ${Number(j.removed).toLocaleString('ja-JP')}）。`)
      setOpenId(null)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(f: OsUpdateFileRow) {
    const n = deliveredCount(f.id)
    const text = `${f.file_id} を取り下げますか？\n届け先の ${n.toLocaleString('ja-JP')} 拠点から外します。` +
      'すでに拠点が受け取った分は取り消せません（拠点の画面で取りやめます）。'
    if (!(await askConfirm(text, { confirmLabel: '取り下げ', danger: true }))) return
    const res = await fetch(`/api/admin/os-updates/${f.id}`, { method: 'DELETE' })
    if (!res.ok) { setErr(`取り下げできませんでした（${res.status}）`); return }
    setMsg(`${f.file_id} を取り下げました。`)
    if (openId === f.id) setOpenId(null)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* 登録 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-1 font-bold text-slate-900">OS 更新ファイルの登録</h2>
        <p className="mb-3 text-xs text-slate-500">
          当社の鍵で署名した OS 更新ファイル（<code className="font-mono">.signed</code>・
          <code className="font-mono">nvmsosu1.…</code> で始まる 1 行）を登録します。中身は書き換えずにそのまま拠点へ届け、
          署名は拠点が確かめます。<b>登録しただけでは、どの拠点にも届きません。</b>
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">ファイル（.signed）</span>
            <input type="file" accept=".signed,.txt" onChange={(e) => void loadFile(e.target.files?.[0] ?? null)}
                   className="block w-full text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-slate-50" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">メモ（任意）</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000}
                   className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                   placeholder="例: GVMS-SA-2026-001 の修正・検証機で通し済み" />
          </label>
          <label className="block text-xs md:col-span-2">
            <span className="mb-1 block font-medium text-slate-600">中身（ファイルを選ぶと入ります。貼り付けも可）</span>
            <textarea value={signed} onChange={(e) => setSigned(e.target.value)} rows={3}
                      className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px] break-all"
                      placeholder="nvmsosu1.…" />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {err && <span className="mr-auto text-xs text-red-700">{err}</span>}
          {msg && !err && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
          <button onClick={() => void register()} disabled={busy || !signed.trim()}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            <Upload size={14} strokeWidth={1.5} aria-hidden /> {busy ? '処理中…' : '登録'}
          </button>
        </div>
      </section>

      {/* 台帳 */}
      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <div className="flex items-baseline gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="font-bold text-slate-900">登録済みのファイル</h2>
          <span className="text-[11px] text-slate-400">
            受け取れる拠点 {capableCount.toLocaleString('ja-JP')} / G・VMS の拠点 {edges.length.toLocaleString('ja-JP')}
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">番号</th>
              <th className="px-4 py-2 text-left">題</th>
              <th className="px-4 py-2 text-right">部品</th>
              <th className="px-4 py-2 text-left">再起動</th>
              <th className="px-4 py-2 text-right">届け先</th>
              <th className="px-4 py-2 text-left">登録日時</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <FileRows key={f.id} f={f} delivered={deliveredCount(f.id)} isOpen={openId === f.id}
                        edges={edges} picked={picked} busy={busy} fileById={fileById}
                        onOpen={() => open(f)} onToggle={toggle} onPick={setPicked}
                        onDeliver={() => void deliver(f)} onWithdraw={() => void withdraw(f)} />
            ))}
            {files.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">OS 更新ファイルはまだ登録されていません</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function FileRows({ f, delivered, isOpen, edges, picked, busy, fileById, onOpen, onToggle, onPick, onDeliver, onWithdraw }: {
  f: OsUpdateFileRow; delivered: number; isOpen: boolean; edges: OsUpdateEdgeRow[]; picked: Set<string>; busy: boolean
  fileById: Map<string, OsUpdateFileRow>
  onOpen: () => void; onToggle: (id: string) => void; onPick: (s: Set<string>) => void
  onDeliver: () => void; onWithdraw: () => void
}) {
  const withdrawn = !!f.withdrawn_at
  const capable = edges.filter((e) => e.capable)
  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-4 py-2 font-mono font-medium">{f.file_id}</td>
        <td className="px-4 py-2 text-slate-700">
          {f.title}
          {(f.cve || f.notes) && <div className="mt-0.5 text-[11px] text-slate-400">{[f.cve, f.notes].filter(Boolean).join('・')}</div>}
        </td>
        <td className="px-4 py-2 text-right font-mono tabular-nums" title={f.packages.map((p) => `${p.name} ≥ ${p.at_least}`).join('\n')}>
          {f.packages.length.toLocaleString('ja-JP')} 個
        </td>
        <td className="px-4 py-2">{f.reboot ? 'あり' : 'なし'}</td>
        <td className="px-4 py-2 text-right font-mono tabular-nums">
          {withdrawn ? <span className="rounded bg-slate-100 px-2 py-0.5 font-sans text-[11px] text-slate-500">取り下げ済み</span> : `${delivered.toLocaleString('ja-JP')} 拠点`}
        </td>
        <td className="px-4 py-2 text-slate-500">{fmtTime(f.created_at)}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right">
          {!withdrawn && (
            <>
              <button onClick={onOpen}
                      className="mr-2 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">
                <Send size={12} strokeWidth={1.5} aria-hidden /> {isOpen ? '閉じる' : '届け先を選ぶ'}
              </button>
              <button onClick={onWithdraw}
                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50">
                <Trash2 size={12} strokeWidth={1.5} aria-hidden /> 取り下げ
              </button>
            </>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={7} className="px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-medium text-slate-600">まとめて選ぶ:</span>
              <button onClick={() => onPick(new Set(capable.filter((e) => e.urgent + e.routine > 0).map((e) => e.id)))}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">OS の更新が要る拠点</button>
              <button onClick={() => onPick(new Set(capable.map((e) => e.id)))}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">受け取れる拠点すべて</button>
              <button onClick={() => onPick(new Set())}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">選択を外す</button>
              <span className="ml-auto text-slate-500">選択中 {picked.size.toLocaleString('ja-JP')} 拠点</span>
              <button onClick={onDeliver} disabled={busy}
                      className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                <Send size={12} strokeWidth={1.5} aria-hidden /> この届け先で保存
              </button>
            </div>
            <table className="w-full rounded border border-slate-200 bg-white text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold tracking-wider text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-1.5"></th>
                  <th className="px-3 py-1.5 text-left">拠点（エッジ）</th>
                  <th className="px-3 py-1.5 text-left">テナント</th>
                  <th className="px-3 py-1.5 text-left">稼働版</th>
                  <th className="px-3 py-1.5 text-left">OS の更新</th>
                  <th className="px-3 py-1.5 text-left">今届けているファイル</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => {
                  const other = e.fileId && e.fileId !== f.id ? fileById.get(e.fileId) : null
                  return (
                    <tr key={e.id} className={'border-t border-slate-100 ' + (e.capable ? '' : 'text-slate-400')}>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={picked.has(e.id)} disabled={!e.capable} onChange={() => onToggle(e.id)}
                               aria-label={`${e.name} へ届ける`} />
                      </td>
                      <td className="px-3 py-1.5">
                        <a href={`/admin/edges/${e.id}`} className="text-blue-600 hover:underline">{e.store ?? e.name}</a>
                        {e.store && <span className="ml-1 text-[11px] text-slate-400">{e.name}</span>}
                      </td>
                      <td className="px-3 py-1.5">{e.tenant ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono">{e.version || '—'}</td>
                      <td className="px-3 py-1.5">
                        {!e.capable ? '受け取れません（1.0.0 より前）'
                          : e.urgent > 0 ? <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">緊急 {e.urgent.toLocaleString('ja-JP')} 件</span>
                          : e.routine > 0 ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">定期保守 {e.routine.toLocaleString('ja-JP')} 件</span>
                          : '要る更新なし'}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {e.fileId === f.id ? f.file_id : other ? other.file_id : '—'}
                      </td>
                    </tr>
                  )
                })}
                {edges.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">G・VMS の拠点がありません</td></tr>
                )}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
