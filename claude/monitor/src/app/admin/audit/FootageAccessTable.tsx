'use client'

/**
 * 証跡静止画アクセス（footage_access_log）の一覧＋列フィルタ＋CSVダウンロード。
 * サーバー側で email / カメラ名を解決済みの行を受け取り、クライアントで絞り込み・書出しする。
 */
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'

export interface FootageRowVM {
  id: string
  accessedAt: string   // ISO
  accessType: 'alarm_snapshot' | 'alarm_frame' | 'patrol_snapshot' | 'bcp_export'
  storeName: string
  actorEmail: string
  cameraName: string
  resourceId: string
}

const TYPE_LABEL: Record<FootageRowVM['accessType'], string> = {
  alarm_snapshot: '発報スナップ', alarm_frame: '発報フレーム',
  patrol_snapshot: '巡回スナップ', bcp_export: 'BCPエクスポート',
}
const TYPE_STYLE: Record<FootageRowVM['accessType'], string> = {
  alarm_snapshot: 'bg-red-100 text-red-700', alarm_frame: 'bg-amber-100 text-amber-700',
  patrol_snapshot: 'bg-blue-100 text-blue-700', bcp_export: 'bg-violet-100 text-violet-700',
}

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

function toCsv(rows: FootageRowVM[]): string {
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
  const header = ['アクセス日時', '種別', '店舗', '操作者', '対象カメラ', '対象ID']
  const lines = rows.map((r) => [
    fmtJst(r.accessedAt), TYPE_LABEL[r.accessType], r.storeName, r.actorEmail, r.cameraName, r.resourceId,
  ].map(esc).join(','))
  return [header.map(esc).join(','), ...lines].join('\r\n')
}

export function FootageAccessTable({ rows }: { rows: FootageRowVM[] }) {
  const [fType, setFType]   = useState('')
  const [fStore, setFStore] = useState('')
  const [fActor, setFActor] = useState('')
  const [fCam, setFCam]     = useState('')

  const stores = useMemo(() => [...new Set(rows.map((r) => r.storeName).filter(Boolean))].sort(), [rows])
  const actors = useMemo(() => [...new Set(rows.map((r) => r.actorEmail).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => rows.filter((r) =>
    (!fType  || r.accessType === fType) &&
    (!fStore || r.storeName === fStore) &&
    (!fActor || r.actorEmail === fActor) &&
    (!fCam   || r.cameraName.toLowerCase().includes(fCam.toLowerCase()))
  ), [rows, fType, fStore, fActor, fCam])

  function downloadCsv() {
    const csv = '﻿' + toCsv(filtered)   // BOM付き＝Excelで文字化けしない
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
    a.href = url; a.download = `footage-access-${stamp}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  if (rows.length === 0) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">記録はまだありません（証跡映像を閲覧すると記録されます）。</div>
  }

  return (
    <div className="space-y-2">
      {/* 絞り込み＋CSV */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={fType} onChange={(e) => setFType(e.target.value)} className={ctrl}>
          <option value="">種別（全て）</option>
          {(Object.keys(TYPE_LABEL) as FootageRowVM['accessType'][]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
        </select>
        <select value={fStore} onChange={(e) => setFStore(e.target.value)} className={ctrl}>
          <option value="">店舗（全て）</option>
          {stores.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fActor} onChange={(e) => setFActor(e.target.value)} className={ctrl}>
          <option value="">操作者（全て）</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={fCam} onChange={(e) => setFCam(e.target.value)} placeholder="カメラ名で絞込" className={ctrl} />
        <span className="text-[11px] text-slate-400">{filtered.length} / {rows.length} 件</span>
        <button onClick={downloadCsv}
          className="ml-auto inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-gedline dark:text-gedink">
          <Download size={13} strokeWidth={1.75} aria-hidden /> CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
            <tr>
              <th className="px-3 py-2 text-left">アクセス日時</th>
              <th className="px-3 py-2 text-left">種別</th>
              <th className="px-3 py-2 text-left">店舗</th>
              <th className="px-3 py-2 text-left">操作者</th>
              <th className="px-3 py-2 text-left">対象カメラ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-gedline dark:hover:bg-gedbg3/40">
                <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-gedink2">{fmtJst(r.accessedAt)}</td>
                <td className="px-3 py-2"><span className={'rounded px-1.5 py-px text-[10px] font-bold ' + TYPE_STYLE[r.accessType]}>{TYPE_LABEL[r.accessType]}</span></td>
                <td className="px-3 py-2 text-slate-700 dark:text-gedink2">{r.storeName || '—'}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-gedink2">{r.actorEmail || '—'}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-gedink2">{r.cameraName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
