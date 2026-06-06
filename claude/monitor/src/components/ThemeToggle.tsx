'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * アプリ全体のテーマ切替（ライト＝和紙 / ダーク＝管制）。
 *
 * モード: 'light' | 'dark' | 'auto'
 *   auto = 固定時間帯。夜間（DARK_FROM〜DARK_TO）はダーク、日中はライト。
 * 選択は localStorage('app-theme') に保存。documentElement に .dark を付与/除去し、
 * 全ページに適用（globals.css の .dark オーバーライドで slate/white 系を一括反転）。
 * auto は 60 秒ごとに再評価。初回ちらつきは layout.tsx の同期スクリプトで防止。
 *
 * AppHeader（常時ダーク slate-900）に置くため、トグル自体はダーク地用の配色。
 */
const KEY = 'app-theme'
const DARK_FROM = 18 // 18:00〜
const DARK_TO = 6    // 〜06:00

type Mode = 'light' | 'dark' | 'auto'

function isNightNow(): boolean {
  const h = new Date().getHours()
  return h >= DARK_FROM || h < DARK_TO
}

function effectiveDark(mode: Mode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return isNightNow()
}

function apply(mode: Mode) {
  document.documentElement.classList.toggle('dark', effectiveDark(mode))
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('auto')

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Mode | null) ?? 'auto'
    setMode(saved)
    apply(saved)
    // auto のとき時刻で変わるので定期再評価（永続・離脱しても解除しない）
    const id = setInterval(() => {
      const m = (localStorage.getItem(KEY) as Mode | null) ?? 'auto'
      if (m === 'auto') apply('auto')
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const choose = useCallback((m: Mode) => {
    setMode(m)
    localStorage.setItem(KEY, m)
    apply(m)
  }, [])

  const opts: { m: Mode; label: string; icon: string }[] = [
    { m: 'light', label: 'ライト', icon: '☀' },
    { m: 'dark', label: 'ダーク', icon: '☾' },
    { m: 'auto', label: '自動', icon: '◐' },
  ]

  return (
    <div
      className="flex overflow-hidden rounded border border-slate-700"
      role="group"
      aria-label="テーマ切替"
      title="ライト / ダーク / 自動（18:00〜06:00 はダーク）"
    >
      {opts.map((o) => {
        const active = mode === o.m
        return (
          <button
            key={o.m}
            type="button"
            onClick={() => choose(o.m)}
            aria-pressed={active}
            className={
              'flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors ' +
              (active
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800')
            }
          >
            <span aria-hidden>{o.icon}</span>
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
