'use client'

import { useState, useTransition } from 'react'
import { upsertCameraConfig } from '../actions'

export interface CameraConfig {
  cameraId: string
  cameraName: string
  channel: number
  aiPrompt: string
  sensitivity: number
  patrolEnabled: boolean
  baselineDayUrl: string
  baselineNightUrl: string
}

export function CameraRow({ cam }: { cam: CameraConfig }) {
  const [prompt, setPrompt] = useState(cam.aiPrompt)
  const [sensitivity, setSensitivity] = useState(cam.sensitivity)
  const [enabled, setEnabled] = useState(cam.patrolEnabled)
  const [dayUrl, setDayUrl] = useState(cam.baselineDayUrl)
  const [nightUrl, setNightUrl] = useState(cam.baselineNightUrl)
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function save() {
    startTransition(async () => {
      const res = await upsertCameraConfig({
        cameraId: cam.cameraId,
        aiPrompt: prompt,
        sensitivity,
        patrolEnabled: enabled,
        baselineDayUrl: dayUrl || null,
        baselineNightUrl: nightUrl || null,
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
    })
  }

  return (
    <tr className="border-t border-slate-100 align-top dark:border-gedline dark:text-gedink2">
      <td className="px-3 py-2 font-medium whitespace-nowrap dark:text-gedink">
        {cam.cameraName}<span className="ml-1 text-slate-400 dark:text-gedink3">ch{cam.channel}</span>
      </td>
      <td className="px-3 py-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={`${cam.cameraName} 巡回有効`} />
      </td>
      <td className="px-3 py-2">
        <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例: シャッターは閉まっているか"
          className="w-56 rounded border border-slate-200 px-1.5 py-0.5 dark:border-gedline dark:bg-gedbg3 dark:text-gedink" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))}
          className="w-16 rounded border border-slate-200 px-1.5 py-0.5 dark:border-gedline dark:bg-gedbg3 dark:text-gedink" />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <input type="text" value={dayUrl} onChange={(e) => setDayUrl(e.target.value)} placeholder="昼 baseline URL"
            className="w-44 rounded border border-slate-200 px-1.5 py-0.5 dark:border-gedline dark:bg-gedbg3 dark:text-gedink" />
          <input type="text" value={nightUrl} onChange={(e) => setNightUrl(e.target.value)} placeholder="夜 baseline URL"
            className="w-44 rounded border border-slate-200 px-1.5 py-0.5 dark:border-gedline dark:bg-gedbg3 dark:text-gedink" />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <button onClick={save} disabled={pending}
          className="rounded bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90">
          {saved ? '保存済' : pending ? '保存中' : '保存'}
        </button>
      </td>
    </tr>
  )
}
