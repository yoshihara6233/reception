'use client'

/**
 * 発報設定（店舗別）— 有効/無効・通知先・静音時間・Webhook。
 * /admin/bcp と同形: 行内クイックトグル＋展開編集に加え、チェック選択→一括反映を備える。
 */
import { useMemo, useState, useTransition } from 'react'
import { prefLabel } from '@/lib/jp-prefectures'
import { upsertAlarmSettings, bulkUpsertAlarmSettings, type AlarmSettingsInput } from '../actions'

export interface AlarmSetting {
  storeId: string
  storeName: string
  areaCode: string | null
  enabled: boolean
  notifyEmails: string[]
  quietFrom: string | null
  quietTo: string | null
  notifyWebhookUrl: string | null
}

const toInput = (r: AlarmSetting): AlarmSettingsInput => ({
  storeId: r.storeId, enabled: r.enabled, notifyEmails: r.notifyEmails,
  quietFrom: r.quietFrom, quietTo: r.quietTo, notifyWebhookUrl: r.notifyWebhookUrl,
})

/** どのフィールドを一括適用するか（指定した項目のみ上書き）。 */
interface BulkPatch {
  enabled?: boolean
  notifyEmails?: string[]
  quietFrom?: string | null
  quietTo?: string | null
  notifyWebhookUrl?: string | null
}

export function AlarmSettingsTable({ initialRows }: { initialRows: AlarmSetting[] }) {
  const [rows, setRows] = useState(initialRows)
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulk, setShowBulk] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pending, startTransition] = useTransition()

  const areas = useMemo(() => [...new Set(rows.map((r) => r.areaCode).filter(Boolean) as string[])].sort(), [rows])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) =>
      (!needle || r.storeName.toLowerCase().includes(needle)) &&
      (!area || r.areaCode === area) &&
      (status === 'all' || (status === 'on' ? r.enabled : !r.enabled)),
    )
  }, [rows, q, area, status])

  const filteredIds = filtered.map((r) => r.storeId)
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))

  const updateRow = (n: AlarmSetting) => setRows((prev) => prev.map((r) => (r.storeId === n.storeId ? n : r)))

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

  function quickToggle(r: AlarmSetting) {
    const next = { ...r, enabled: !r.enabled }
    updateRow(next); setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertAlarmSettings(toInput(next))
      if (!res.ok) { updateRow(r); setErr(res.error ?? '保存に失敗しました') }
    })
  }
  function save(next: AlarmSetting) {
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await upsertAlarmSettings(toInput(next))
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
      const res = await bulkUpsertAlarmSettings(merged.map(toInput))
      if (res.ok) {
        merged.forEach(updateRow)
        setMsg(`${res.count}件に適用しました`)
        setShowBulk(false)
        setTimeout(() => setMsg(''), 2500)
      } else {
        setErr(res.error ?? '一括反映に失敗しました')
      }
    })
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="space-y-3">
      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名で検索" className={`${ctrl} w-48`} />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={ctrl}>
          <option value="">全エリア</option>
          {areas.map((a) => <option key={a} value={a}>{prefLabel(a)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'on' | 'off')} className={ctrl}>
          <option value="all">すべて</option><option value="on">有効</option><option value="off">無効</option>
        </select>
        <span className="text-[11px] text-slate-400">{filtered.length} / {rows.length} 件</span>
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
        </div>
      </div>

      {/* 一括ツールバー */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900/50 dark:bg-blue-950/30">
          <span className="font-semibold text-blue-800 dark:text-blue-200">{selected.size}件 選択中</span>
          <button onClick={() => setShowBulk((v) => !v)} disabled={pending}
            className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            一括反映 {showBulk ? '▲' : '▼'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-blue-700 hover:underline dark:text-blue-300">選択解除</button>
        </div>
      )}

      {showBulk && selected.size > 0 && <BulkPanel pending={pending} onApply={applyBulk} />}

      {/* テーブル */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-gedline">
        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="全選択" />
              </th>
              <th className="px-3 py-2">店舗</th>
              <th className="px-3 py-2">エリア</th>
              <th className="px-3 py-2">有効</th>
              <th className="px-3 py-2">通知先</th>
              <th className="px-3 py-2">静音時間</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gedline">
            {filtered.map((r) => (
              <Row key={r.storeId} r={r} selected={selected.has(r.storeId)} expanded={expanded === r.storeId} pending={pending}
                onSelect={() => toggleSelect(r.storeId)}
                onToggle={() => quickToggle(r)} onExpand={() => setExpanded(expanded === r.storeId ? null : r.storeId)} onSave={save} />
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">該当する店舗がありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ r, selected, expanded, pending, onSelect, onToggle, onExpand, onSave }: {
  r: AlarmSetting; selected: boolean; expanded: boolean; pending: boolean
  onSelect: () => void; onToggle: () => void; onExpand: () => void; onSave: (n: AlarmSetting) => void
}) {
  const [emails, setEmails] = useState(r.notifyEmails.join(', '))
  const [qf, setQf] = useState(r.quietFrom ?? '')
  const [qt, setQt] = useState(r.quietTo ?? '')
  const [webhook, setWebhook] = useState(r.notifyWebhookUrl ?? '')
  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function save() {
    onSave({
      ...r,
      notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
      quietFrom: qf || null, quietTo: qt || null, notifyWebhookUrl: webhook.trim() || null,
    })
  }

  return (
    <>
      <tr className={selected ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
        <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={onSelect} /></td>
        <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">{r.storeName}</td>
        <td className="px-3 py-2 text-slate-500">{prefLabel(r.areaCode)}</td>
        <td className="px-3 py-2">
          <button onClick={onToggle} disabled={pending}
            className={'rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ' +
              (r.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                         : 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3')}>
            {r.enabled ? 'ON' : 'OFF'}
          </button>
        </td>
        <td className="px-3 py-2 text-slate-500">
          {r.notifyEmails.length === 0 ? '—' : r.notifyEmails.length === 1 ? r.notifyEmails[0] : `${r.notifyEmails[0]} 他${r.notifyEmails.length - 1}`}
        </td>
        <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
          {r.quietFrom && r.quietTo ? `${r.quietFrom}–${r.quietTo}` : '—'}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={onExpand} className="text-blue-600 hover:underline dark:text-gedaccent">{expanded ? '閉じる' : '編集'}</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-3 py-3 dark:bg-gedbg3/40">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">通知先</span>
                <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${ctrl} min-w-[280px] flex-1`} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">静音時間</span>
                <input type="time" value={qf} onChange={(e) => setQf(e.target.value)} className={`${ctrl} w-28`} />
                <span className="text-slate-400">〜</span>
                <input type="time" value={qt} onChange={(e) => setQt(e.target.value)} className={`${ctrl} w-28`} />
                <span className="text-[11px] text-slate-400">この時間帯は通知を抑制（発報は記録）</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-semibold text-slate-500 dark:text-gedink3">Webhook</span>
                <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…（任意・外部連携先へ JSON POST）" className={`${ctrl} min-w-[280px] flex-1`} />
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

/** 一括反映パネル: 適用する項目だけチェックして値を設定 → 選択店舗へ上書き。 */
function BulkPanel({ pending, onApply }: { pending: boolean; onApply: (patch: BulkPatch) => void }) {
  const [useEnabled, setUseEnabled] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [useEmails, setUseEmails] = useState(false)
  const [emails, setEmails] = useState('')
  const [useQuiet, setUseQuiet] = useState(false)
  const [qf, setQf] = useState('')
  const [qt, setQt] = useState('')
  const [useWebhook, setUseWebhook] = useState(false)
  const [webhook, setWebhook] = useState('')

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  function apply() {
    const patch: BulkPatch = {}
    if (useEnabled) patch.enabled = enabled
    if (useEmails) patch.notifyEmails = emails.split(',').map((e) => e.trim()).filter(Boolean)
    if (useQuiet) { patch.quietFrom = qf || null; patch.quietTo = qt || null }
    if (useWebhook) patch.notifyWebhookUrl = webhook.trim() || null
    onApply(patch)
  }

  const rowCls = 'flex flex-wrap items-center gap-2'
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-gedline dark:bg-gedbg2">
      <p className="text-[11px] text-slate-500 dark:text-gedink3">適用したい項目だけチェックを入れ、値を設定して「選択店舗に反映」を押してください。チェックした項目のみ上書きします。</p>

      <div className={rowCls}>
        <label className="flex w-28 items-center gap-1.5"><input type="checkbox" checked={useEnabled} onChange={(e) => setUseEnabled(e.target.checked)} />有効</label>
        <select disabled={!useEnabled} value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')} className={ctrl}>
          <option value="1">有効にする</option>
          <option value="0">無効にする</option>
        </select>
      </div>

      <div className={rowCls}>
        <label className="flex w-28 items-center gap-1.5"><input type="checkbox" checked={useEmails} onChange={(e) => setUseEmails(e.target.checked)} />通知先</label>
        <input disabled={!useEmails} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com（空で通知先をクリア）" className={`${ctrl} min-w-[280px] flex-1`} />
      </div>

      <div className={rowCls}>
        <label className="flex w-28 items-center gap-1.5"><input type="checkbox" checked={useQuiet} onChange={(e) => setUseQuiet(e.target.checked)} />静音時間</label>
        <input type="time" disabled={!useQuiet} value={qf} onChange={(e) => setQf(e.target.value)} className={`${ctrl} w-28`} />
        <span className="text-slate-400">〜</span>
        <input type="time" disabled={!useQuiet} value={qt} onChange={(e) => setQt(e.target.value)} className={`${ctrl} w-28`} />
        <span className="text-[11px] text-slate-400">空欄で静音なし</span>
      </div>

      <div className={rowCls}>
        <label className="flex w-28 items-center gap-1.5"><input type="checkbox" checked={useWebhook} onChange={(e) => setUseWebhook(e.target.checked)} />Webhook</label>
        <input disabled={!useWebhook} value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…（空でクリア）" className={`${ctrl} min-w-[280px] flex-1`} />
      </div>

      <button onClick={apply} disabled={pending}
        className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? '反映中…' : '選択店舗に反映'}
      </button>
    </div>
  )
}
