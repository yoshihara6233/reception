'use client'

import { useState, useTransition } from 'react'
import { downloadJpeg, jstStamp } from '@/lib/saveJpeg'

/**
 * 「表示中の画像をJPEG保存」ボタン。
 * `endpoint` は同一オリジンの JPEG ルート（grid / snapshot）。クリック時に
 * キャッシュバスター付きで現フレームを取得し `<name>_<JST>.jpg` で保存する。
 */
export function SaveJpegButton({
  endpoint,
  name,
  className,
  label = 'JPEG保存',
}: {
  endpoint: string
  name: string
  className?: string
  label?: string
}) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState(false)

  function save() {
    setErr(false)
    start(async () => {
      try {
        const sep = endpoint.includes('?') ? '&' : '?'
        await downloadJpeg(`${endpoint}${sep}_dl=${Date.now()}`, `${name}_${jstStamp()}.jpg`)
      } catch {
        setErr(true)
        setTimeout(() => setErr(false), 2500)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={pending}
      title="表示中の画像をJPEGで保存"
      className={
        className ??
        'inline-flex items-center gap-1 rounded bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black/70 disabled:opacity-50'
      }
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {err ? '保存失敗' : pending ? '保存中…' : label}
    </button>
  )
}
