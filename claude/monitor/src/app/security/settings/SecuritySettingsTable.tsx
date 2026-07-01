'use client'

/**
 * 巡回設定（店舗別）一覧＋一括変更。/admin/bcp と同形。
 * 固定時刻モード: 1日最大4回の巡回時刻を店舗毎に指定（全曜日実施・曜日指定なし）。
 */
import { useMemo, useState, useTransition } from 'react'
import { prefLabel } from '@/lib/jp-prefectures'
import { upsertSecurityPatrolTimes, bulkUpsertSecurityPatrolTimes, type SecurityPatrolInput } from '../actions'

export interface SecuritySetting {
  storeId: string
  storeName: string
  areaCode: string | null
  enabled: boolean
  patrolTimes: string[]   // "HH:MM" 最大4
  notifyEmails: string[]
}

const pad4 = (times: string[]): string[] => [0, 1, 2, 3].map((i) => times[i] ?? '')
const timesSummary = (t: string[]) => {
  const v = t.filter(Boolean)
  return v.length ? v.join(' / ') : '未設定'
}
const toInput = (r: SecuritySetting): SecurityPatrolInput => ({
  storeId: r.storeId, patrolTimes: r.patrolTimes, notifyEmails: r.notifyEmails, enabled: r.enabled,
})

export function SecuritySettingsTable({ initialRows }: { initialRows: SecuritySetting[] }) {
  const [rows, setRows] = useState<SecuritySetting[]>(initialRows)
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pending, startTransition] = useTransition()

  const areas = useMemo(
    () => [...new Set(rows.map((r) => r.areaCode).filter(Boolean) as string[])].sort(),
    [rows],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (needle && !r.storeName.toLowerCase().includes(needle)) return false
      if (area && r.areaCode !== area) return false
      if (status === 'on' && !r.enabled) return false
      if (status === 'off' && r.enabled) return false
      return true
    })
  }, [rows, q, area, status])

  const filteredIds = filtered.map((r) => r.storeId)
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))
  const updateRow = (next: SecuritySetting) => setRows((prev) => prev.map((r) => (r.storeId === next.storeId ? next : r)))

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allSelected) filteredIds.forEach((id) => n.delete(id))
      else filteredIds.forEach((id) => n.add(id))
      return n
    })
  }

  function quickToggleEnabled(r: SecuritySetting) {
    const next = { ...r, enabled: !r.enabled }
    updateRow(next); setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertSecurityPatrolTimes(toInput(next))
      if (!res.ok) { updateRow(r); setErr(res.error ?? '保存に失敗しました') }
    })
  }

  function saveRow(next: SecuritySetting) {
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertSecurityPatrolTimes(toInput(next))
      if (res.ok) { updateRow(next); setExpanded(null); setMsg('保存しました'); setTimeout(() => setMsg(''), 2000) }
      else setErr(res.error ?? '保存に失敗しました')
    })
  }

  function applyBulk(patch: { enabled?: boolean; patrolTimes?: string[]; notifyEmails?: string[] }) {
    const targets = rows.filter((r) => selected.has(r.storeId))
    if (targets.length === 0) { setErr('店舗を選択してください'); return }
    if (Object.keys(patch).length === 0) { setErr('適用する項目を選んでください'); return }
    setErr(''); setMsg('')
    const merged = targets.map((r) => ({ ...r, ...patch }))
    startTransition(async () => {
      const res = await bulkUpsertSecurityPatrolTimes(merged.map(toInput))
      if (res.ok) {
        merged.forEach(updateRow)
        setMsg(`${res.count}件に適用しました`); setShowBulk(false); setTimeout(() => setMsg(''), 2500)
      } else setErr(res.error ?? '一括適用に失敗しました')
    })
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名で検索" className={`${ctrl} w-48`} />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={ctrl}>
          <option value="">全エリア</option>
          {areas.map((a) => <option key={a} value={a}>{prefLabel(a)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'on' | 'off')} className={ctrl}>
          <option value="all">すべて</option>
          <option value="on">有効</option>
          <option value="off">無効</option>
        </select>
        <span className="text-[11px] text-slate-400">{filtered.length} / {rows.length} 件</span>
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900/50 dark:bg-blue-950/30">
          <span className="font-semibold text-blue-800 dark:text-blue-200">{selected.size}件 選択中</span>
          <button onClick={() => setShowBulk((v) => !v)} disabled={pending}
            className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            一括設定 {showBulk ? '▲' : '▼'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-blue-700 hover:underline dark:text-blue-300">選択解除</button>
        </div>
      )}
      {showBulk && selected.size > 0 && <BulkPanel pending={pending} onApply={applyBulk} />}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-gedline">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
            <tr>
              <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="全選択" /></th>
              <th className="px-3 py-2">店舗</th>
              <th className="px-3 py-2">エリア</th>
              <th className="px-3 py-2">有効</th>
              <th className="px-3 py-2">巡回時刻（1日最大4回）</th>
              <th className="px-3 py-2">通知先</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gedline">
            {filtered.map((r) => (
              <Row
                key={r.storeId}
                r={r}
                selected={selected.has(r.storeId)}
                expanded={expanded === r.storeId}
                pending={pending}
                onSelect={() => toggleSelect(r.storeId)}
                onToggleEnabled={() => quickToggleEnabled(r)}
                onExpand={() => setExpanded(expanded === r.storeId ? null : r.storeId)}
                onSave={saveRow}
              />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">該当する店舗がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({
  r, selected, expanded, pending, onSelect, onToggleEnabled, onExpand, onSave,
}: {
  r: SecuritySetting
  selected: boolean
  expanded: boolean
  pending: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onExpand: () => void
  onSave: (next: SecuritySetting) => void
}) {
  const [times, setTimes] = useState<string[]>(pad4(r.patrolTimes))
  const [emails, setEmails] = useState(r.notifyEmails.join(', '))
  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function save() {
    onSave({
      ...r,
      patrolTimes: times.filter(Boolean),
      notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
    })
  }

  return (
    <>
      <tr className={selected ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
        <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={onSelect} /></td>
        <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">{r.storeName}</td>
        <td className="px-3 py-2 text-slate-500">{prefLabel(r.areaCode)}</td>
        <td className="px-3 py-2">
          <button onClick={onToggleEnabled} disabled={pending}
            className={'rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ' +
              (r.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                         : 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3')}>
            {r.enabled ? 'ON' : 'OFF'}
          </button>
        </td>
        <td className="px-3 py-2 font-mono tabular-nums text-slate-600 dark:text-gedink2">{timesSummary(r.patrolTimes)}</td>
        <td className="px-3 py-2 text-slate-500">
          {r.notifyEmails.length === 0 ? '—' : r.notifyEmails.length === 1 ? r.notifyEmails[0] : `${r.notifyEmails[0]} 他${r.notifyEmails.length - 1}`}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={onExpand} className="text-blue-600 hover:underline dark:text-gedaccent">{expanded ? '閉じる' : '編集'}</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-3 py-3 dark:bg-gedbg3/40">
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-gedink3">巡回時刻（1日最大4回・全曜日実施）</div>
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <input
                      key={i} type="time" value={times[i] ?? ''}
                      onChange={(e) => setTimes((prev) => { const n = [...prev]; n[i] = e.target.value; return n })}
                      className={`${ctrl} w-28`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">通知先</span>
                <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${ctrl} min-w-[280px] flex-1`} />
              </div>
              <button onClick={save} disabled={pending}
                className="rounded bg-slate-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg">
                {pending ? '保存中…' : '保存'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** 一括適用パネル: 適用する項目だけチェックして値を設定。 */
function BulkPanel({ pending, onApply }: { pending: boolean; onApply: (patch: { enabled?: boolean; patrolTimes?: string[]; notifyEmails?: string[] }) => void }) {
  const [useEnabled, setUseEnabled] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [useTimes, setUseTimes] = useState(false)
  const [times, setTimes] = useState<string[]>(['', '', '', ''])
  const [useNotify, setUseNotify] = useState(false)
  const [emails, setEmails] = useState('')

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function apply() {
    const patch: { enabled?: boolean; patrolTimes?: string[]; notifyEmails?: string[] } = {}
    if (useEnabled) patch.enabled = enabled
    if (useTimes) patch.patrolTimes = times.filter(Boolean)
    if (useNotify) patch.notifyEmails = emails.split(',').map((e) => e.trim()).filter(Boolean)
    onApply(patch)
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-gedline dark:bg-gedbg2">
      <p className="text-[11px] text-slate-500 dark:text-gedink3">適用したい項目だけチェックを入れ、値を設定して「選択店舗に適用」を押してください。</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useEnabled} onChange={(e) => setUseEnabled(e.target.checked)} />有効／無効</label>
        <select disabled={!useEnabled} value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')} className={ctrl}>
          <option value="1">有効にする</option>
          <option value="0">無効にする</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={useTimes} onChange={(e) => setUseTimes(e.target.checked)} />巡回時刻（1日最大4回）</label>
        <div className={'flex flex-wrap gap-2 ' + (useTimes ? '' : 'pointer-events-none opacity-40')}>
          {[0, 1, 2, 3].map((i) => (
            <input key={i} type="time" value={times[i]} onChange={(e) => setTimes((prev) => { const n = [...prev]; n[i] = e.target.value; return n })} className={`${ctrl} w-28`} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useNotify} onChange={(e) => setUseNotify(e.target.checked)} />通知先</label>
        <input disabled={!useNotify} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${ctrl} min-w-[280px] flex-1`} />
      </div>

      <button onClick={apply} disabled={pending}
        className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? '適用中…' : '選択店舗に適用'}
      </button>
    </div>
  )
}
