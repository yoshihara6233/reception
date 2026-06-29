'use client'

import { useState, useTransition } from 'react'
import { Camera } from 'lucide-react'
import { updateFindingStatus } from './actions'

export interface Finding {
  id: string
  storeId: string
  storeName: string
  cameraName: string
  snapshotUrl: string | null
  diffScore: number | null
  status: string
  aiStatus: string
  aiVerdict: string | null
  aiReason: string | null
  aiConfidence: number | null
  createdAt: string
}

function fmtJST(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// AI / status badge — color + label (色だけに頼らずラベル併記)
function VerdictBadge({ f }: { f: Finding }) {
  if (f.aiStatus === 'skipped') {
    return <span className="rounded-full bg-yellow-100 px-2 py-px text-[10px] font-bold text-yellow-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]">未検証（AI上限）</span>
  }
  if (f.aiStatus === 'error') {
    return <span className="rounded-full bg-yellow-100 px-2 py-px text-[10px] font-bold text-yellow-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]">未検証（エラー）</span>
  }
  if (f.aiStatus === 'pending' || f.aiStatus === 'none') {
    return <span className="rounded-full bg-slate-100 px-2 py-px text-[10px] font-bold text-slate-600 dark:bg-gedbg3 dark:text-gedink2">未検証</span>
  }
  if (f.aiVerdict === 'anomaly') {
    const pct = f.aiConfidence != null ? ` ${Math.round(f.aiConfidence * 100)}%` : ''
    return <span className="rounded-full bg-red-100 px-2 py-px text-[10px] font-bold text-red-700 dark:bg-[#A3332B]/25 dark:text-[#E87D74]">異常{pct}</span>
  }
  return <span className="rounded-full bg-emerald-100 px-2 py-px text-[10px] font-bold text-emerald-700 dark:bg-[#3EB373]/15 dark:text-[#5CC98B]">正常</span>
}

export function SecurityTriageClient({ findings }: { findings: Finding[] }) {
  // Severity sort: anomaly verdict first, then by diff_score desc, then recency
  const sorted = [...findings].sort((a, b) => {
    const av = a.aiVerdict === 'anomaly' ? 1 : 0
    const bv = b.aiVerdict === 'anomaly' ? 1 : 0
    if (av !== bv) return bv - av
    const ad = a.diffScore ?? 0, bd = b.diffScore ?? 0
    if (ad !== bd) return bd - ad
    return b.createdAt.localeCompare(a.createdAt)
  })

  const [selectedId, setSelectedId] = useState<string>(sorted[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<Record<string, string>>({})

  const selected = sorted.find((f) => f.id === selectedId) ?? sorted[0]

  function triage(id: string, status: 'confirmed' | 'false_positive') {
    startTransition(async () => {
      const res = await updateFindingStatus(id, status)
      if (res.ok) setDone((d) => ({ ...d, [id]: status }))
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      {/* Queue */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">
          異常キュー（重要度順）
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-gedline">
          {sorted.map((f) => {
            const isAnom = f.aiVerdict === 'anomaly'
            const resolved = done[f.id]
            return (
              <li
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={
                  'flex cursor-pointer items-center gap-3 px-3 py-2.5 ' +
                  (f.id === selectedId ? 'bg-blue-50 dark:bg-gedbg3 ' : 'hover:bg-slate-50 dark:hover:bg-gedbg3 ') +
                  (isAnom ? 'shadow-[inset_3px_0_0_#dc2626] dark:shadow-[inset_3px_0_0_#E87D74]' : '')
                }
              >
                <div className="flex h-10 w-16 flex-none items-center justify-center rounded bg-slate-200 text-[9px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
                  {f.snapshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.snapshotUrl} alt="" className="h-full w-full rounded object-cover" />
                  ) : <Camera size={18} strokeWidth={1.5} aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800 dark:text-gedink">
                    <span className="truncate">{f.storeName} ／ {f.cameraName}</span>
                    <VerdictBadge f={f} />
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-gedink3">
                    {fmtJST(f.createdAt)}
                    {f.aiReason ? ` ・ ${f.aiReason}` : ''}
                    {f.diffScore != null ? ` ・ 差分${Math.round(f.diffScore * 100)}%` : ''}
                  </div>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  {resolved ? (
                    <span className="rounded px-2 py-px text-[10px] font-bold text-slate-500 dark:text-gedink3">
                      {resolved === 'confirmed' ? '異常確定済' : '誤検知済'}
                    </span>
                  ) : (
                    <>
                      <button
                        disabled={pending}
                        onClick={(e) => { e.stopPropagation(); triage(f.id, 'confirmed') }}
                        className="whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg"
                      >
                        異常確定
                      </button>
                      <button
                        disabled={pending}
                        onClick={(e) => { e.stopPropagation(); triage(f.id, 'false_positive') }}
                        className="whitespace-nowrap rounded border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-700 disabled:opacity-50 dark:border-gedline dark:text-gedink"
                      >
                        誤検知
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Detail */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-gedline dark:bg-gedbg2">
        {selected ? (
          <>
            <div className="mb-2 flex h-40 items-center justify-center rounded bg-slate-200 text-xs text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
              {selected.snapshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.snapshotUrl} alt="現在スナップショット" className="h-full w-full rounded object-contain" />
              ) : '現在スナップショット（未取得）'}
            </div>
            <dl className="space-y-1 text-[11px] dark:text-gedink">
              <div className="flex justify-between border-b border-dashed border-slate-200 py-1 dark:border-gedline">
                <dt className="text-slate-500 dark:text-gedink3">店舗</dt><dd className="font-medium">{selected.storeName}</dd>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 py-1 dark:border-gedline">
                <dt className="text-slate-500 dark:text-gedink3">カメラ</dt><dd className="font-medium">{selected.cameraName}</dd>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 py-1 dark:border-gedline">
                <dt className="text-slate-500 dark:text-gedink3">時刻</dt><dd>{fmtJST(selected.createdAt)}</dd>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 py-1 dark:border-gedline">
                <dt className="text-slate-500 dark:text-gedink3">差分スコア</dt>
                <dd>{selected.diffScore != null ? selected.diffScore.toFixed(2) : '—'}</dd>
              </div>
            </dl>
            {selected.aiReason && (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-[11px] dark:border-gedline dark:bg-gedbg3 dark:text-gedink">
                <b>AI所見</b>：{selected.aiReason}
                {selected.aiConfidence != null && `（信頼度${Math.round(selected.aiConfidence * 100)}%）`}
                <div className="mt-1 text-[10px] text-slate-400 dark:text-gedink3">※状態検出のみ・個人識別なし</div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500 dark:text-gedink3">finding を選択してください。</p>
        )}
      </div>
    </div>
  )
}
