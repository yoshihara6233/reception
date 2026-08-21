'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { upsertBcpSettings } from './actions'

export interface BcpStoreSetting {
  storeId:           string
  storeName:         string
  areaCode:          string | null
  enabled:           boolean
  quakeMinIntensity: string
  specialWarningEnabled: boolean
  notifyEmails:      string[]
  snapshotOffsets:   number[]
}

/** レポートで撮影するオフセット（発令からの分）の選択肢。 */
export const OFFSET_OPTIONS: { value: number; label: string }[] = [
  { value: -5, label: '5分前' },
  { value: 0,  label: '発生時' },
  { value: 5,  label: '5分後' },
  { value: 10, label: '10分後' },
  { value: 15, label: '15分後' },
  { value: 20, label: '20分後' },
  { value: 25, label: '25分後' },
  { value: 30, label: '30分後' },
]

/** 震度しきい値の選択肢（JMA MaxInt 表記 → 日本式ラベル）。 */
export const INTENSITY_OPTIONS: { value: string; label: string }[] = [
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

export function BcpSettingsCard({ row, onSaved }: { row: BcpStoreSetting; onSaved?: (next: BcpStoreSetting) => void }) {
  const [enabled, setEnabled]   = useState(row.enabled)
  const [intensity, setInt]     = useState(row.quakeMinIntensity)
  const [special, setSpecial]   = useState(row.specialWarningEnabled)
  const [emails, setEmails]     = useState(row.notifyEmails.join(', '))
  const [offsets, setOffsets]   = useState<number[]>(
    row.snapshotOffsets.length > 0 ? row.snapshotOffsets : [-5, 5],
  )
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr]     = useState('')

  function toggleOffset(value: number) {
    setOffsets((prev) =>
      prev.includes(value) ? prev.filter((o) => o !== value) : [...prev, value].sort((a, b) => a - b),
    )
  }

  function save() {
    setErr('')
    if (offsets.length === 0) { setErr('撮影タイミングを1つ以上選んでください'); return }
    const notifyEmails = emails.split(',').map((e) => e.trim()).filter(Boolean)
    startTransition(async () => {
      const res = await upsertBcpSettings({
        storeId:           row.storeId,
        enabled,
        quakeMinIntensity: intensity,
        specialWarningEnabled: special,
        notifyEmails,
        snapshotOffsets:   offsets,
      })
      if (res.ok) {
        setSaved(true); setTimeout(() => setSaved(false), 1500)
        onSaved?.({
          ...row,
          enabled, quakeMinIntensity: intensity, specialWarningEnabled: special,
          notifyEmails, snapshotOffsets: offsets,
        })
      }
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
            BCPレポート自動作成
          </label>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-red-600 dark:text-[#E87D74]">{err}</span>}
          <button onClick={save} disabled={pending}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90">
            {saved ? <>保存済 <Check size={14} strokeWidth={1.5} aria-hidden /></> : pending ? '保存中…' : '保存'}
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
              <input type="checkbox" checked={special} onChange={(e) => setSpecial(e.target.checked)} />
              特別警報（警戒レベル5） 発表で録画する
            </label>
            <p className="text-[10px] leading-relaxed text-slate-400">
              特別警報は大雨・土砂災害・高潮・大雪・暴風・暴風雪・波浪の各特別警報が対象です。
              警報・注意報（レベル4以下）では録画しません。
            </p>
            <p className="text-[10px] leading-relaxed text-slate-400">
              条件未満の発令も「Jアラート受信履歴」には残ります（録画を起動しないだけ）。
            </p>
          </div>
        </fieldset>

        {/* 通知 */}
        <fieldset className="rounded border border-slate-200 p-3 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">通知</legend>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="w-20 pt-1 text-slate-500">通知先</span>
              <input type="text" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="a@example.com, b@example.com" className={`${input} flex-1`} />
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              発令時に取得開始、証拠PDF生成後に完了メールを送信します。
            </p>
          </div>
        </fieldset>

        {/* 撮影タイミング（レポート写真） */}
        <fieldset className="rounded border border-slate-200 p-3 md:col-span-2 dark:border-gedline">
          <legend className="px-1 text-[11px] font-bold text-slate-500 dark:text-gedink3">
            撮影タイミング（レポート写真 {offsets.length}枚）
          </legend>
          <div className="flex flex-wrap gap-2 text-xs">
            {OFFSET_OPTIONS.map((o) => {
              const on = offsets.includes(o.value)
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => toggleOffset(o.value)}
                  className={
                    'rounded-full border px-3 py-1 transition ' +
                    (on
                      ? 'border-blue-600 bg-blue-600 text-white dark:border-gedaccent dark:bg-gedaccent dark:text-gedbg'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2')
                  }
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            選んだタイミングのスナップだけを撮影・PDF化します。枚数が少ないほど容量・通信・レコーダ負荷が下がります（既定: 5分前・5分後）。
          </p>
        </fieldset>
      </div>
    </div>
  )
}
