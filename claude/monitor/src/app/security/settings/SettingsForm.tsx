'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { upsertSecuritySettings } from '../actions'

export interface StoreSetting {
  storeId: string
  storeName: string
  areaCode: string | null
  scheduleMode: 'interval' | 'fixed'
  patrolIntervalMin: number
  activeFrom: string
  activeTo: string
  activeDays: number[]
  patrolTimes: string[]
  aiEnabled: boolean
  aiDailyCap: number
  notifyEmails: string[]
  reportShowVerification: boolean
  enabled: boolean
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function SettingsCard({ row }: { row: StoreSetting }) {
  const [enabled, setEnabled] = useState(row.enabled)
  const [mode, setMode] = useState<'interval' | 'fixed'>(row.scheduleMode)
  const [interval, setInterval] = useState(row.patrolIntervalMin)
  const [from, setFrom] = useState(row.activeFrom)
  const [to, setTo] = useState(row.activeTo)
  const [days, setDays] = useState<number[]>(row.activeDays)
  const [times, setTimes] = useState(row.patrolTimes.join(', '))
  const [aiEnabled, setAiEnabled] = useState(row.aiEnabled)
  const [aiCap, setAiCap] = useState(row.aiDailyCap)
  const [showVerif, setShowVerif] = useState(row.reportShowVerification)
  const [emails, setEmails] = useState(row.notifyEmails.join(', '))
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  function toggleDay(d: number) {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort())
  }

  function save() {
    setErr('')
    startTransition(async () => {
      const res = await upsertSecuritySettings({
        storeId: row.storeId,
        scheduleMode: mode,
        patrolIntervalMin: interval,
        activeFrom: from,
        activeTo: to,
        activeDays: days,
        patrolTimes: times.split(',').map((t) => t.trim()).filter(Boolean),
        aiEnabled,
        aiDailyCap: aiCap,
        notifyEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
        reportShowVerification: showVerif,
        enabled,
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
      else setErr(res.error ?? '保存に失敗しました')
    })
  }

  const input = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
      {/* Header row: store name + enable toggle + save */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-gedink">{row.storeName}</h3>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-gedink2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            巡回を有効化
          </label>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
          <button onClick={save} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90">
            {saved ? <>保存済 <Check size={13} strokeWidth={2} aria-hidden /></> : pending ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className={'grid gap-4 md:grid-cols-2 dark:text-gedink2 ' + (enabled ? '' : 'opacity-50 pointer-events-none')}>
        {/* Schedule */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">巡回スケジュール</legend>

          <div className="mb-2 flex gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`mode-${row.storeId}`} checked={mode === 'interval'} onChange={() => setMode('interval')} />
              間隔
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`mode-${row.storeId}`} checked={mode === 'fixed'} onChange={() => setMode('fixed')} />
              指定時刻
            </label>
          </div>

          {mode === 'interval' ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-12 text-slate-500">時間帯</span>
                <input type="time" value={from === '24:00' ? '23:59' : from} onChange={(e) => setFrom(e.target.value)} className={input} />
                <span>〜</span>
                <input type="time" value={to === '24:00' ? '23:59' : to} onChange={(e) => setTo(e.target.value === '23:59' ? '24:00' : e.target.value)} className={input} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 text-slate-500">間隔</span>
                <input type="number" min={1} max={1440} value={interval} onChange={(e) => setInterval(Number(e.target.value))} className={`${input} w-20`} />
                <span className="text-slate-500">分毎</span>
              </div>
              <p className="text-[10px] text-slate-400">例: 22:00〜06:00 を 30分毎 → 夜間に8回前後巡回</p>
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-12 pt-1 text-slate-500">時刻</span>
                <input type="text" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="22:00, 02:00, 06:00" className={`${input} flex-1`} />
              </div>
              <p className="text-[10px] text-slate-400">HH:MM をカンマ区切り。指定した時刻ちょうどに巡回。</p>
            </div>
          )}

          {/* Days */}
          <div className="mt-3">
            <span className="text-[11px] text-slate-500">曜日</span>
            <div className="mt-1 flex gap-1">
              {DAY_LABELS.map((label, d) => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={
                    'h-7 w-7 rounded text-[11px] font-medium ' +
                    (days.includes(d) ? 'bg-slate-800 text-white dark:bg-gedaccent dark:text-gedbg' : 'border border-slate-200 text-slate-500 dark:border-gedline dark:text-gedink2')
                  }>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        {/* AI + notify + report */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">分析・通知</legend>
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
              AI分析を有効化
            </label>
            <div className="flex items-center gap-2">
              <span className="w-24 text-slate-500">AI日次上限</span>
              <input type="number" min={0} value={aiCap} onChange={(e) => setAiCap(Number(e.target.value))} className={`${input} w-24`} />
              <span className="text-slate-400">回/日・店舗</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showVerif} onChange={(e) => setShowVerif(e.target.checked)} />
              報告書に検証方法・カバレッジを明示
            </label>
            <div className="flex items-start gap-2">
              <span className="w-24 pt-1 text-slate-500">通知先</span>
              <input type="text" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${input} flex-1`} />
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
