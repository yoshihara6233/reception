'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { upsertMonitorSettings } from '../actions'

export interface StoreSetting {
  storeId: string
  storeName: string
  enabled: boolean
  edgeOfflineThresholdMin: number
  checkIntervalMin: number
  failThreshold: number
  okThreshold: number
  notifyEmails: string[]
  maintenanceUntil: string | null
}

// ISO -> datetime-local (YYYY-MM-DDTHH:mm) in local time
function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MonitorSettingsCard({ row }: { row: StoreSetting }) {
  const [enabled, setEnabled] = useState(row.enabled)
  const [offlineMin, setOfflineMin] = useState(row.edgeOfflineThresholdMin)
  const [intervalMin, setIntervalMin] = useState(row.checkIntervalMin)
  const [failN, setFailN] = useState(row.failThreshold)
  const [okM, setOkM] = useState(row.okThreshold)
  const [emails, setEmails] = useState(row.notifyEmails.join(', '))
  const [maint, setMaint] = useState(isoToLocal(row.maintenanceUntil))
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  function save() {
    setErr('')
    startTransition(async () => {
      const res = await upsertMonitorSettings({
        storeId: row.storeId,
        enabled,
        edgeOfflineThresholdMin: offlineMin,
        checkIntervalMin: intervalMin,
        failThreshold: failN,
        okThreshold: okM,
        notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
        maintenanceUntil: maint ? new Date(maint).toISOString() : null,
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
      else setErr(res.error ?? '保存に失敗しました')
    })
  }

  const input = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-gedink">{row.storeName}</h3>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-gedink2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            監視を有効化
          </label>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
          <button onClick={save} disabled={pending}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90">
            {saved ? <><Check size={13} strokeWidth={2} aria-hidden />保存済</> : pending ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className={'grid gap-4 md:grid-cols-2 dark:text-gedink2 ' + (enabled ? '' : 'opacity-50 pointer-events-none')}>
        {/* 死活・チェック */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">死活・チェック</legend>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-28 text-slate-500 dark:text-gedink3">エッジ無応答判定</span>
              <input type="number" min={1} max={1440} value={offlineMin} onChange={(e) => setOfflineMin(Number(e.target.value))} className={`${input} w-20`} />
              <span className="text-slate-400 dark:text-gedink3">分 無応答で障害</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 text-slate-500 dark:text-gedink3">チェック間隔</span>
              <input type="number" min={1} max={1440} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} className={`${input} w-20`} />
              <span className="text-slate-400 dark:text-gedink3">分毎（P2の能動チェック）</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 text-slate-500 dark:text-gedink3">発報/解決</span>
              連続<input type="number" min={1} max={20} value={failN} onChange={(e) => setFailN(Number(e.target.value))} className={`${input} w-14`} />回失敗で発報・連続<input type="number" min={1} max={20} value={okM} onChange={(e) => setOkM(Number(e.target.value))} className={`${input} w-14`} />回OKで解決
            </div>
          </div>
        </fieldset>

        {/* 通知・メンテ */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">通知・メンテナンス</legend>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="w-28 pt-1 text-slate-500 dark:text-gedink3">通知先</span>
              <input type="text" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com, oncall@example.com" className={`${input} flex-1`} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 text-slate-500 dark:text-gedink3">メンテ窓</span>
              <input type="datetime-local" value={maint} onChange={(e) => setMaint(e.target.value)} className={input} />
              {maint && <button type="button" onClick={() => setMaint('')} className="text-[11px] text-slate-400 underline dark:text-gedink3">解除</button>}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-gedink3">メンテ窓まではアラートを抑制します。</p>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
