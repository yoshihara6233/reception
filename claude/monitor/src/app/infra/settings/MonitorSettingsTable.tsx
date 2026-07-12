'use client'

/**
 * 監視設定（店舗別）一覧＋一括変更。/security/settings（SecuritySettingsTable）と同形:
 * 検索・エリア・状態で絞り込み → 複数選択 → 一括設定（変更したい項目だけ適用）。
 * 行の「編集」で個別の閾値・通知先・メンテ窓を展開編集する。
 */
import { useMemo, useState, useTransition } from 'react'
import { prefLabel } from '@/lib/jp-prefectures'
import { upsertMonitorSettings, bulkUpsertMonitorSettings, type MonitorSettingsInput } from '../actions'

export interface MonitorSetting {
  storeId: string
  storeName: string
  areaCode: string | null
  enabled: boolean
  edgeOfflineThresholdMin: number
  checkIntervalMin: number
  failThreshold: number
  okThreshold: number
  notifyEmails: string[]
  maintenanceUntil: string | null
}

/** 一括適用パッチ: undefined の項目は変更しない。maintenanceUntil は null=解除。 */
interface BulkPatch {
  enabled?: boolean
  edgeOfflineThresholdMin?: number
  checkIntervalMin?: number
  failThreshold?: number
  okThreshold?: number
  notifyEmails?: string[]
  maintenanceUntil?: string | null
}

const toInput = (r: MonitorSetting): MonitorSettingsInput => ({
  storeId: r.storeId,
  enabled: r.enabled,
  edgeOfflineThresholdMin: r.edgeOfflineThresholdMin,
  checkIntervalMin: r.checkIntervalMin,
  failThreshold: r.failThreshold,
  okThreshold: r.okThreshold,
  notifyEmails: r.notifyEmails,
  maintenanceUntil: r.maintenanceUntil,
})

// ISO -> datetime-local (YYYY-MM-DDTHH:mm) in local time
function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function maintSummary(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  if (d.getTime() < Date.now()) return '—'   // 過去のメンテ窓は実質解除
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}まで`
}

export function MonitorSettingsTable({ initialRows }: { initialRows: MonitorSetting[] }) {
  const [rows, setRows] = useState<MonitorSetting[]>(initialRows)
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
  const updateRow = (next: MonitorSetting) => setRows((prev) => prev.map((r) => (r.storeId === next.storeId ? next : r)))

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allSelected) filteredIds.forEach((id) => n.delete(id))
      else filteredIds.forEach((id) => n.add(id))
      return n
    })
  }

  function quickToggleEnabled(r: MonitorSetting) {
    const next = { ...r, enabled: !r.enabled }
    updateRow(next); setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertMonitorSettings(toInput(next))
      if (!res.ok) { updateRow(r); setErr(res.error ?? '保存に失敗しました') }
    })
  }

  function saveRow(next: MonitorSetting) {
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertMonitorSettings(toInput(next))
      if (res.ok) { updateRow(next); setExpanded(null); setMsg('保存しました'); setTimeout(() => setMsg(''), 2000) }
      else setErr(res.error ?? '保存に失敗しました')
    })
  }

  function applyBulk(patch: BulkPatch) {
    const targets = rows.filter((r) => selected.has(r.storeId))
    if (targets.length === 0) { setErr('店舗を選択してください'); return }
    if (Object.keys(patch).length === 0) { setErr('適用する項目を選んでください'); return }
    setErr(''); setMsg('')
    const merged = targets.map((r) => ({ ...r, ...patch }))
    startTransition(async () => {
      const res = await bulkUpsertMonitorSettings(merged.map(toInput))
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
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
            <tr>
              <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="全選択" /></th>
              <th className="px-3 py-2">店舗</th>
              <th className="px-3 py-2">エリア</th>
              <th className="px-3 py-2">有効</th>
              <th className="px-3 py-2">閾値（無応答 / 間隔 / 発報・解決）</th>
              <th className="px-3 py-2">通知先</th>
              <th className="px-3 py-2">メンテ窓</th>
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
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">該当する店舗がありません。</td></tr>
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
  r: MonitorSetting
  selected: boolean
  expanded: boolean
  pending: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onExpand: () => void
  onSave: (next: MonitorSetting) => void
}) {
  const [offlineMin, setOfflineMin] = useState(r.edgeOfflineThresholdMin)
  const [intervalMin, setIntervalMin] = useState(r.checkIntervalMin)
  const [failN, setFailN] = useState(r.failThreshold)
  const [okM, setOkM] = useState(r.okThreshold)
  const [emails, setEmails] = useState(r.notifyEmails.join(', '))
  const [maint, setMaint] = useState(isoToLocal(r.maintenanceUntil))
  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function save() {
    onSave({
      ...r,
      edgeOfflineThresholdMin: offlineMin,
      checkIntervalMin: intervalMin,
      failThreshold: failN,
      okThreshold: okM,
      notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
      maintenanceUntil: maint ? new Date(maint).toISOString() : null,
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
        <td className="px-3 py-2 font-mono tabular-nums text-slate-600 dark:text-gedink2">
          {r.edgeOfflineThresholdMin}分 / {r.checkIntervalMin}分毎 / {r.failThreshold}回→発報・{r.okThreshold}回→解決
        </td>
        <td className="px-3 py-2 text-slate-500">
          {r.notifyEmails.length === 0 ? '—' : r.notifyEmails.length === 1 ? r.notifyEmails[0] : `${r.notifyEmails[0]} 他${r.notifyEmails.length - 1}`}
        </td>
        <td className="px-3 py-2 text-slate-500">{maintSummary(r.maintenanceUntil)}</td>
        <td className="px-3 py-2 text-right">
          <button onClick={onExpand} className="text-blue-600 hover:underline dark:text-gedaccent">{expanded ? '閉じる' : '編集'}</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-slate-50 px-3 py-3 dark:bg-gedbg3/40">
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-gedink3">エッジ無応答判定</span>
                  <input type="number" min={1} max={1440} value={offlineMin} onChange={(e) => setOfflineMin(Number(e.target.value))} className={`${ctrl} w-20`} />
                  <span className="text-slate-400">分</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-gedink3">チェック間隔</span>
                  <input type="number" min={1} max={1440} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} className={`${ctrl} w-20`} />
                  <span className="text-slate-400">分毎</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-gedink3">発報/解決</span>
                  連続<input type="number" min={1} max={20} value={failN} onChange={(e) => setFailN(Number(e.target.value))} className={`${ctrl} w-14`} />回失敗で発報・
                  連続<input type="number" min={1} max={20} value={okM} onChange={(e) => setOkM(Number(e.target.value))} className={`${ctrl} w-14`} />回OKで解決
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">通知先</span>
                <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com, oncall@example.com" className={`${ctrl} min-w-[280px] flex-1`} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">メンテ窓</span>
                <input type="datetime-local" value={maint} onChange={(e) => setMaint(e.target.value)} className={ctrl} />
                {maint && <button type="button" onClick={() => setMaint('')} className="text-[11px] text-slate-400 underline dark:text-gedink3">解除</button>}
                <span className="text-[10px] text-slate-400 dark:text-gedink3">メンテ窓まではアラートを抑制します。</span>
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

/** 一括適用パネル: 適用する項目だけチェックして値を設定（/security/settings と同形）。 */
function BulkPanel({ pending, onApply }: { pending: boolean; onApply: (patch: BulkPatch) => void }) {
  const [enabledSel, setEnabledSel] = useState<'' | 'on' | 'off'>('')
  const [useThresholds, setUseThresholds] = useState(false)
  const [offlineMin, setOfflineMin] = useState(5)
  const [intervalMin, setIntervalMin] = useState(5)
  const [failN, setFailN] = useState(3)
  const [okM, setOkM] = useState(2)
  const [useNotify, setUseNotify] = useState(false)
  const [emails, setEmails] = useState('')
  const [maintSel, setMaintSel] = useState<'' | 'set' | 'clear'>('')
  const [maint, setMaint] = useState('')

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function apply() {
    const patch: BulkPatch = {}
    if (enabledSel) patch.enabled = enabledSel === 'on'
    if (useThresholds) {
      patch.edgeOfflineThresholdMin = offlineMin
      patch.checkIntervalMin = intervalMin
      patch.failThreshold = failN
      patch.okThreshold = okM
    }
    if (useNotify) patch.notifyEmails = emails.split(',').map((e) => e.trim()).filter(Boolean)
    if (maintSel === 'set' && maint) patch.maintenanceUntil = new Date(maint).toISOString()
    if (maintSel === 'clear') patch.maintenanceUntil = null
    onApply(patch)
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-gedline dark:bg-gedbg2">
      <p className="text-[11px] text-slate-500 dark:text-gedink3">変更する項目だけ設定して「選択店舗に適用」を押してください（「変更しない」の項目は現状のまま）。</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-slate-600 dark:text-gedink2">有効／無効</span>
        <select value={enabledSel} onChange={(e) => setEnabledSel(e.target.value as '' | 'on' | 'off')} className={ctrl}>
          <option value="">変更しない</option>
          <option value="on">有効にする</option>
          <option value="off">無効にする</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={useThresholds} onChange={(e) => setUseThresholds(e.target.checked)} />閾値（無応答・間隔・発報/解決）</label>
        <div className={'flex flex-wrap items-center gap-x-4 gap-y-2 ' + (useThresholds ? '' : 'pointer-events-none opacity-40')}>
          <label className="flex items-center gap-1.5">無応答<input type="number" min={1} max={1440} value={offlineMin} onChange={(e) => setOfflineMin(Number(e.target.value))} className={`${ctrl} w-20`} />分</label>
          <label className="flex items-center gap-1.5">間隔<input type="number" min={1} max={1440} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} className={`${ctrl} w-20`} />分毎</label>
          <label className="flex items-center gap-1.5">連続<input type="number" min={1} max={20} value={failN} onChange={(e) => setFailN(Number(e.target.value))} className={`${ctrl} w-14`} />回失敗で発報</label>
          <label className="flex items-center gap-1.5">連続<input type="number" min={1} max={20} value={okM} onChange={(e) => setOkM(Number(e.target.value))} className={`${ctrl} w-14`} />回OKで解決</label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex w-40 items-center gap-1.5"><input type="checkbox" checked={useNotify} onChange={(e) => setUseNotify(e.target.checked)} />通知先</label>
        <input disabled={!useNotify} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com, oncall@example.com" className={`${ctrl} min-w-[280px] flex-1`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-slate-600 dark:text-gedink2">メンテ窓</span>
        <select value={maintSel} onChange={(e) => setMaintSel(e.target.value as '' | 'set' | 'clear')} className={ctrl}>
          <option value="">変更しない</option>
          <option value="set">設定する</option>
          <option value="clear">解除する</option>
        </select>
        {maintSel === 'set' && (
          <input type="datetime-local" value={maint} onChange={(e) => setMaint(e.target.value)} className={ctrl} />
        )}
      </div>

      <button onClick={apply} disabled={pending}
        className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? '適用中…' : '選択店舗に適用'}
      </button>
    </div>
  )
}
