'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  BcpSettingsCard,
  INTENSITY_OPTIONS,
  OFFSET_OPTIONS,
  type BcpStoreSetting,
} from './BcpSettingsForm'
import { bulkUpsertBcpSettings, upsertBcpSettings, type BcpSettingInput } from './actions'

const intensityLabel = (v: string) =>
  INTENSITY_OPTIONS.find((o) => o.value === v)?.label ?? v
const offsetLabel = (v: number) =>
  OFFSET_OPTIONS.find((o) => o.value === v)?.label ?? `${v}分`
const offsetsSummary = (offs: number[]) =>
  offs.length === 0 ? '—' : [...offs].sort((a, b) => a - b).map(offsetLabel).join('・')

const toInput = (r: BcpStoreSetting): BcpSettingInput => ({
  storeId:           r.storeId,
  enabled:           r.enabled,
  quakeMinIntensity: r.quakeMinIntensity,
  tsunamiEnabled:    r.tsunamiEnabled,
  missileEnabled:    r.missileEnabled,
  notifyEmails:      r.notifyEmails,
  snapshotOffsets:   r.snapshotOffsets,
})

/** どのフィールドを一括適用するか。 */
interface BulkPatch {
  enabled?: boolean
  quakeMinIntensity?: string
  tsunamiEnabled?: boolean
  missileEnabled?: boolean
  snapshotOffsets?: number[]
}

export function BcpSettingsTable({ initialRows }: { initialRows: BcpStoreSetting[] }) {
  const [rows, setRows]       = useState<BcpStoreSetting[]>(initialRows)
  const [q, setQ]             = useState('')
  const [area, setArea]       = useState('')
  const [status, setStatus]   = useState<'all' | 'on' | 'off'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [msg, setMsg]         = useState('')
  const [err, setErr]         = useState('')
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

  function updateRow(next: BcpStoreSetting) {
    setRows((prev) => prev.map((r) => (r.storeId === next.storeId ? next : r)))
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allSelected) filteredIds.forEach((id) => n.delete(id))
      else filteredIds.forEach((id) => n.add(id))
      return n
    })
  }

  /** 行内の「自動作成」即時トグル（その場で保存）。 */
  function quickToggleEnabled(r: BcpStoreSetting) {
    const next = { ...r, enabled: !r.enabled }
    updateRow(next)             // 楽観的更新
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertBcpSettings(toInput(next))
      if (!res.ok) { updateRow(r); setErr(res.error ?? '保存に失敗しました') }
    })
  }

  function applyBulk(patch: BulkPatch) {
    const targets = rows.filter((r) => selected.has(r.storeId))
    if (targets.length === 0) { setErr('店舗を選択してください'); return }
    if (Object.keys(patch).length === 0) { setErr('適用する項目を選んでください'); return }
    setErr(''); setMsg('')
    const merged = targets.map((r) => ({ ...r, ...patch }))
    startTransition(async () => {
      const res = await bulkUpsertBcpSettings(merged.map(toInput))
      if (res.ok) {
        merged.forEach(updateRow)
        setMsg(`${res.count}件に適用しました`)
        setShowBulk(false)
        setTimeout(() => setMsg(''), 2500)
      } else {
        setErr(res.error ?? '一括適用に失敗しました')
      }
    })
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="店舗名で検索" className={`${ctrl} w-48`}
        />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={ctrl}>
          <option value="">全エリア</option>
          {areas.map((a) => <option key={a} value={a}>エリア {a}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'on' | 'off')} className={ctrl}>
          <option value="all">すべて</option>
          <option value="on">自動作成 ON</option>
          <option value="off">自動作成 OFF</option>
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
          <button onClick={() => setSelected(new Set())} className="text-blue-700 hover:underline dark:text-blue-300">
            選択解除
          </button>
        </div>
      )}

      {showBulk && selected.size > 0 && (
        <BulkPanel pending={pending} onApply={applyBulk} />
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-gedline">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="全選択" />
              </th>
              <th className="px-3 py-2">店舗</th>
              <th className="px-3 py-2">エリア</th>
              <th className="px-3 py-2">自動作成</th>
              <th className="px-3 py-2">地震</th>
              <th className="px-3 py-2">津波</th>
              <th className="px-3 py-2">ミサイル</th>
              <th className="px-3 py-2">撮影タイミング</th>
              <th className="px-3 py-2">通知先</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gedline">
            {filtered.map((r) => (
              <FragmentRow
                key={r.storeId}
                r={r}
                selected={selected.has(r.storeId)}
                expanded={expanded === r.storeId}
                pending={pending}
                onSelect={() => toggleSelect(r.storeId)}
                onToggleEnabled={() => quickToggleEnabled(r)}
                onExpand={() => setExpanded(expanded === r.storeId ? null : r.storeId)}
                onSaved={(next) => { updateRow(next); setExpanded(null) }}
              />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">該当する店舗がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({
  r, selected, expanded, pending, onSelect, onToggleEnabled, onExpand, onSaved,
}: {
  r: BcpStoreSetting
  selected: boolean
  expanded: boolean
  pending: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onExpand: () => void
  onSaved: (next: BcpStoreSetting) => void
}) {
  const yn = (b: boolean) => (b ? <span className="text-emerald-600">○</span> : <span className="text-slate-300">—</span>)
  return (
    <>
      <tr className={selected ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
        <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={onSelect} /></td>
        <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">{r.storeName}</td>
        <td className="px-3 py-2 text-slate-500">{r.areaCode ?? '—'}</td>
        <td className="px-3 py-2">
          <button onClick={onToggleEnabled} disabled={pending}
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ' +
              (r.enabled
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3')
            }>
            {r.enabled ? 'ON' : 'OFF'}
          </button>
        </td>
        <td className="px-3 py-2 text-slate-600 dark:text-gedink2">{intensityLabel(r.quakeMinIntensity)}</td>
        <td className="px-3 py-2 text-center">{yn(r.tsunamiEnabled)}</td>
        <td className="px-3 py-2 text-center">{yn(r.missileEnabled)}</td>
        <td className="px-3 py-2 text-slate-600 dark:text-gedink2">
          <span className="font-semibold">{r.snapshotOffsets.length}枚</span>
          <span className="ml-1 text-slate-400">{offsetsSummary(r.snapshotOffsets)}</span>
        </td>
        <td className="px-3 py-2 text-slate-500">
          {r.notifyEmails.length === 0 ? '—' : r.notifyEmails.length === 1 ? r.notifyEmails[0] : `${r.notifyEmails[0]} 他${r.notifyEmails.length - 1}`}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={onExpand} className="text-blue-600 hover:underline dark:text-gedaccent">
            {expanded ? '閉じる' : '編集'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-3 py-3 dark:bg-gedbg3/40">
            <BcpSettingsCard row={r} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  )
}

/** 一括適用パネル: 適用する項目だけチェックして値を設定。 */
function BulkPanel({ pending, onApply }: { pending: boolean; onApply: (patch: BulkPatch) => void }) {
  const [useEnabled, setUseEnabled]   = useState(false)
  const [enabled, setEnabled]         = useState(true)
  const [useInt, setUseInt]           = useState(false)
  const [intensity, setIntensity]     = useState('5+')
  const [useTsunami, setUseTsunami]   = useState(false)
  const [tsunami, setTsunami]         = useState(true)
  const [useMissile, setUseMissile]   = useState(false)
  const [missile, setMissile]         = useState(true)
  const [useOffsets, setUseOffsets]   = useState(false)
  const [offsets, setOffsets]         = useState<number[]>([-5, 5])

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function toggleOffset(v: number) {
    setOffsets((prev) => prev.includes(v) ? prev.filter((o) => o !== v) : [...prev, v].sort((a, b) => a - b))
  }

  function apply() {
    const patch: BulkPatch = {}
    if (useEnabled) patch.enabled = enabled
    if (useInt) patch.quakeMinIntensity = intensity
    if (useTsunami) patch.tsunamiEnabled = tsunami
    if (useMissile) patch.missileEnabled = missile
    if (useOffsets) patch.snapshotOffsets = offsets
    onApply(patch)
  }

  const rowCls = 'flex flex-wrap items-center gap-2'
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-gedline dark:bg-gedbg2">
      <p className="text-[11px] text-slate-500 dark:text-gedink3">適用したい項目だけチェックを入れ、値を設定して「選択店舗に適用」を押してください。</p>

      <div className={rowCls}>
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useEnabled} onChange={(e) => setUseEnabled(e.target.checked)} />BCPレポート自動作成</label>
        <select disabled={!useEnabled} value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')} className={ctrl}>
          <option value="1">ON にする</option>
          <option value="0">OFF にする</option>
        </select>
      </div>

      <div className={rowCls}>
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useInt} onChange={(e) => setUseInt(e.target.checked)} />地震しきい値</label>
        <select disabled={!useInt} value={intensity} onChange={(e) => setIntensity(e.target.value)} className={ctrl}>
          {INTENSITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}で録画</option>)}
        </select>
      </div>

      <div className={rowCls}>
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useTsunami} onChange={(e) => setUseTsunami(e.target.checked)} />津波</label>
        <select disabled={!useTsunami} value={tsunami ? '1' : '0'} onChange={(e) => setTsunami(e.target.value === '1')} className={ctrl}>
          <option value="1">録画する</option>
          <option value="0">録画しない</option>
        </select>
      </div>

      <div className={rowCls}>
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useMissile} onChange={(e) => setUseMissile(e.target.checked)} />ミサイル(国民保護)</label>
        <select disabled={!useMissile} value={missile ? '1' : '0'} onChange={(e) => setMissile(e.target.value === '1')} className={ctrl}>
          <option value="1">録画する</option>
          <option value="0">録画しない</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={useOffsets} onChange={(e) => setUseOffsets(e.target.checked)} />撮影タイミング（{offsets.length}枚）</label>
        <div className={'flex flex-wrap gap-2 ' + (useOffsets ? '' : 'pointer-events-none opacity-40')}>
          {OFFSET_OPTIONS.map((o) => {
            const on = offsets.includes(o.value)
            return (
              <button type="button" key={o.value} onClick={() => toggleOffset(o.value)}
                className={'rounded-full border px-3 py-1 ' + (on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2')}>
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      <button onClick={apply} disabled={pending}
        className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? '適用中…' : '選択店舗に適用'}
      </button>
    </div>
  )
}
