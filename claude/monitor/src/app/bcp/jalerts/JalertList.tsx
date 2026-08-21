'use client'

/**
 * Jアラート受信履歴の一覧（クライアント側で種別フィルタ）。
 * データ源は jalert_receipts（ポーラーが店舗マッチに関係なく全件記録）。
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'

export interface JalertRow {
  id:                  string
  alert_type:          string | null
  title:               string | null
  max_intensity:       string | null
  area_codes:          string[] | null
  alert_issued_at:     string | null
  received_at:         string
  matched_store_count: number
  detail_url:          string | null
}

type Filter = 'all' | 'earthquake' | 'special_warning' | 'other'

/** タブを持つ種別。非対応にした津波・ミサイルの過去分は「その他」に入る。 */
const KNOWN = new Set(['earthquake', 'special_warning'])

/** JMA MaxInt 生値（'6+','5-' …）を日本式（'6強','5弱'）に。未知はそのまま。 */
function intensityLabel(raw: string | null): string | null {
  if (!raw) return null
  const map: Record<string, string> = {
    '7': '7', '6+': '6強', '6-': '6弱', '5+': '5強', '5-': '5弱',
    '4': '4', '3': '3', '2': '2', '1': '1',
  }
  return map[raw] ?? raw
}

function typeMeta(type: string | null): { label: string; cls: string } {
  switch (type) {
    case 'earthquake':      return { label: '地震',     cls: 'bg-amber-100 text-amber-800 border-amber-200' }
    case 'special_warning': return { label: '特別警報', cls: 'bg-red-100 text-red-800 border-red-200' }
    // 2026-08-21 に非対応。過去の受信履歴を読めるように残す。
    case 'tsunami':         return { label: '津波',     cls: 'bg-sky-100 text-sky-800 border-sky-200' }
    case 'missile':         return { label: 'ミサイル', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
    default:                return { label: 'その他',   cls: 'bg-slate-100 text-slate-700 border-slate-200' }
  }
}

function fmtJst(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** 強い揺れ（6弱以上）は赤系で強調。 */
function isSevere(raw: string | null): boolean {
  return raw === '7' || raw === '6+' || raw === '6-'
}

export default function JalertList({ rows }: { rows: JalertRow[] }) {
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(() => {
    const c = { all: rows.length, earthquake: 0, special_warning: 0, other: 0 }
    for (const r of rows) {
      if (r.alert_type && KNOWN.has(r.alert_type)) c[r.alert_type as 'earthquake' | 'special_warning']++
      else c.other++
    }
    return c
  }, [rows])

  const shown = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'other') return rows.filter((r) => !r.alert_type || !KNOWN.has(r.alert_type))
    return rows.filter((r) => r.alert_type === filter)
  }, [rows, filter])

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all',             label: `すべて (${counts.all})` },
    { key: 'earthquake',      label: `地震 (${counts.earthquake})` },
    { key: 'special_warning', label: `特別警報 (${counts.special_warning})` },
    { key: 'other',           label: `その他 (${counts.other})` },
  ]

  return (
    <div className="space-y-3">
      {/* 種別フィルタ */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setFilter(tb.key)}
            className={
              'rounded-full border px-3 py-1 text-xs font-semibold transition ' +
              (filter === tb.key
                ? 'border-blue-300 bg-blue-100 text-blue-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
            }
          >
            {tb.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          受信履歴がまだありません。<br />
          ポーラーが毎分実行され、JMA から該当する発令（地震・特別警報）を受信するとここに記録されます。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-bold">受信時刻 (JST)</th>
                <th className="px-3 py-2 font-bold">種別</th>
                <th className="px-3 py-2 font-bold">最大震度</th>
                <th className="px-3 py-2 font-bold">発令内容</th>
                <th className="px-3 py-2 font-bold">該当店舗</th>
                <th className="px-3 py-2 font-bold">詳細</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const tm  = typeMeta(r.alert_type)
                const int = intensityLabel(r.max_intensity)
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{fmtJst(r.received_at)}</td>
                    <td className="px-3 py-2">
                      <span className={'inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ' + tm.cls}>
                        {tm.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {int ? (
                        <span className={'font-bold ' + (isSevere(r.max_intensity) ? 'text-red-600' : 'text-slate-700')}>
                          震度 {int}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      <div className="max-w-md truncate" title={r.title ?? ''}>{r.title ?? '—'}</div>
                      {r.area_codes && r.area_codes.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          対象エリア {r.area_codes.length} 件
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.matched_store_count > 0 ? (
                        <Link href="/bcp" className="font-semibold text-blue-600 hover:underline">
                          {r.matched_store_count} 店舗で録画 →
                        </Link>
                      ) : (
                        <span className="text-slate-400">対象外</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.detail_url ? (
                        <a
                          href={r.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-500 hover:text-blue-600 hover:underline"
                        >
                          JMA原文
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
