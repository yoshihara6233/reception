'use client'

import { useState, useTransition } from 'react'
import { upsertBcpSettings } from './actions'

export interface BcpStoreSetting {
  storeId:           string
  storeName:         string
  areaCode:          string | null
  enabled:           boolean
  quakeMinIntensity: string
  tsunamiEnabled:    boolean
  missileEnabled:    boolean
  preMinutes:        number
  postMinutes:       number
  notifyEmails:      string[]
}

/** 震度しきい値の選択肢（JMA MaxInt 表記 → 日本式ラベル）。 */
const INTENSITY_OPTIONS: { value: string; label: string }[] = [
  { value: '1',  label: '震度1以上' },
  { value: '2',  label: '震度2以上' },
  { value: '3',  label: '震度3以上' },
  { value: '4',  label: '震度4以上' },
  { value: '5-', label: '震度5弱以上' },
  { value: '5+', label: '震度5強以上' },
  { value: '6-', label: '震度6弱以上' },
  { value: '6+', label: '震度6強以上' },
  { value: '7',  label: '震度7' },
]

export function BcpSettingsCard({ row }: { row: BcpStoreSetting }) {
  const [enabled, setEnabled]   = useState(row.enabled)
  const [intensity, setInt]     = useState(row.quakeMinIntensity)
  const [tsunami, setTsunami]   = useState(row.tsunamiEnabled)
  const [missile, setMissile]   = useState(row.missileEnabled)
  const [pre, setPre]           = useState(row.preMinutes)
  const [post, setPost]         = useState(row.postMinutes)
  const [emails, setEmails]     = useState(row.notifyEmails.join(', '))
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr]     = useState('')

  function save() {
    setErr('')
    startTransition(async () => {
      const res = await upsertBcpSettings({
        storeId:           row.storeId,
        enabled,
        quakeMinIntensity: intensity,
        tsunamiEnabled:    tsunami,
        missileEnabled:    missile,
        preMinutes:        pre,
        postMinutes:       post,
        notifyEmails:      emails.split(',').map((e) => e.trim()).filter(Boolean),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
      else setErr(res.error ?? '保存に失敗しました')
    })
  }

  const input = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
      {/* Header: store name + enable + save */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-gedink">{row.storeName}</h3>
          {row.areaCode && <span className="text-[10px] text-slate-400">エリア {row.areaCode}</span>}
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-gedink2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            BCP自動録画を有効化
          </label>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
          <button onClick={save} disabled={pending}
            className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90">
            {saved ? '保存済 ✓' : pending ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className={'grid gap-4 md:grid-cols-2 dark:text-gedink2 ' + (enabled ? '' : 'opacity-50 pointer-events-none')}>
        {/* 発動条件 */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">発動条件</legend>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">地震</span>
              <select value={intensity} onChange={(e) => setInt(e.target.value)} className={`${input} flex-1`}>
                {INTENSITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}で録画</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={tsunami} onChange={(e) => setTsunami(e.target.checked)} />
              津波 発令で録画する
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={missile} onChange={(e) => setMissile(e.target.checked)} />
              ミサイル(国民保護) 発令で録画する
            </label>
            <p className="text-[10px] leading-relaxed text-slate-400">
              条件未満の発令も「Jアラート受信履歴」には残ります（録画を起動しないだけ）。
            </p>
          </div>
        </fieldset>

        {/* 録画範囲・通知 */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">録画範囲・通知</legend>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">発令前</span>
              <input type="number" min={1} max={10} value={pre} onChange={(e) => setPre(Number(e.target.value))} className={`${input} w-20`} />
              <span className="text-slate-400">分</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">発令後</span>
              <input type="number" min={1} max={30} value={post} onChange={(e) => setPost(Number(e.target.value))} className={`${input} w-20`} />
              <span className="text-slate-400">分</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-20 pt-1 text-slate-500">通知先</span>
              <input type="text" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${input} flex-1`} />
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
