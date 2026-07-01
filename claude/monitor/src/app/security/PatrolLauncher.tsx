'use client'

/**
 * 今すぐ巡回ランチャー（/security）。
 * 全店舗を県（area_code）毎にグループ表示し、店舗を複数選択（県単位の一括選択も）して
 * まとめて「今すぐ巡回」を発火する。結果は店舗ごとに表示。巡回結果の閲覧は /security/reports。
 */
import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, MapPin, CheckCircle2, XCircle } from 'lucide-react'
import { triggerManualPatrols } from './actions'

export interface LauncherStore { id: string; name: string }
export interface LauncherGroup { code: string; label: string; stores: LauncherStore[] }

export function PatrolLauncher({ groups }: { groups: LauncherGroup[] }) {
  const router = useRouter()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<Array<{ storeId: string; ok: boolean; error?: string }> | null>(null)

  const allStores = useMemo(() => groups.flatMap((g) => g.stores), [groups])
  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of allStores) m.set(s.id, s.name)
    return m
  }, [allStores])

  const toggle = (id: string) =>
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGroup = (g: LauncherGroup) =>
    setSel((p) => {
      const n = new Set(p)
      const allSel = g.stores.every((s) => n.has(s.id))
      g.stores.forEach((s) => (allSel ? n.delete(s.id) : n.add(s.id)))
      return n
    })
  const toggleAll = () =>
    setSel((p) => (p.size === allStores.length ? new Set() : new Set(allStores.map((s) => s.id))))

  function run() {
    if (!sel.size) return
    setResults(null)
    startTransition(async () => {
      const res = await triggerManualPatrols([...sel])
      setResults(res.results ?? [])
      setTimeout(() => router.refresh(), 8000)
    })
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const fails = results?.filter((r) => !r.ok) ?? []

  return (
    <div className="space-y-4">
      {/* アクションバー */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-gedline dark:bg-gedbg2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-gedink2">
          <input type="checkbox" checked={allStores.length > 0 && sel.size === allStores.length} onChange={toggleAll} />
          全選択
        </label>
        <span className="text-xs text-slate-500 dark:text-gedink3">選択 {sel.size} / 全 {allStores.length} 店舗</span>
        <button
          onClick={run}
          disabled={pending || sel.size === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-gedaccent dark:text-gedbg"
        >
          <Play size={15} strokeWidth={2} aria-hidden /> {pending ? '発火中…' : `今すぐ巡回を実行${sel.size ? `（${sel.size}）` : ''}`}
        </button>
      </div>

      {/* 実行結果 */}
      {results && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-gedline dark:bg-gedbg2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-[#5CC98B]"><CheckCircle2 size={14} strokeWidth={2} aria-hidden /> 発火 {okCount}</span>
            {fails.length > 0 && <span className="inline-flex items-center gap-1 text-red-600 dark:text-[#E87D74]"><XCircle size={14} strokeWidth={2} aria-hidden /> 失敗 {fails.length}</span>}
            <span className="text-slate-400 dark:text-gedink3">— 結果は巡回レポートに反映されます</span>
          </div>
          {fails.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {fails.map((r) => (
                <li key={r.storeId} className="text-slate-600 dark:text-gedink2">
                  <span className="font-medium">{nameById.get(r.storeId) ?? r.storeId}</span>
                  <span className="text-red-600 dark:text-[#E87D74]"> — {r.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 県グループ */}
      {groups.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-gedink3">店舗がありません。</p>
      ) : (
        groups.map((g) => {
          const allSel = g.stores.every((s) => sel.has(s.id))
          const someSel = !allSel && g.stores.some((s) => sel.has(s.id))
          return (
            <div key={g.code} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
              <label className="flex cursor-pointer items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-gedline dark:bg-gedbg3">
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = someSel }}
                  onChange={() => toggleGroup(g)}
                />
                <MapPin size={14} strokeWidth={1.75} aria-hidden className="text-slate-400 dark:text-gedink3" />
                <span className="text-[13px] font-semibold text-slate-800 dark:text-gedink">{g.label}</span>
                <span className="text-[11px] text-slate-400 dark:text-gedink3">{g.stores.length} 店舗</span>
              </label>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.stores.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-slate-700 hover:bg-slate-50 dark:text-gedink dark:hover:bg-gedbg3">
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
