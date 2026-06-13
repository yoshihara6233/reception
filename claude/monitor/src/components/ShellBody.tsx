'use client'

import { useEffect, useState } from 'react'

/**
 * Desktop 3-column body (StoreTree | content | StoreDetail) with a
 * collapsible right-hand detail panel. The open/closed state is persisted to
 * localStorage so it sticks across navigations. Collapsing reclaims the 360px
 * track (the grid template switches), giving the monitor view full width.
 *
 * `tree`, `content` and `detail` are server-rendered nodes passed in from the
 * (server) AppShell — Server Components can be handed to a Client Component as
 * props.
 */
export function ShellBody({
  tree,
  content,
  detail,
}: {
  tree: React.ReactNode
  content: React.ReactNode
  detail: React.ReactNode | null
}) {
  const hasDetail = detail != null
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('storeDetail:open')
    if (saved !== null) setOpen(saved === '1')
  }, [])

  function toggle() {
    setOpen((o) => {
      localStorage.setItem('storeDetail:open', o ? '0' : '1')
      return !o
    })
  }

  const showDetail = hasDetail && open
  const cols = showDetail ? 'md:grid-cols-[280px_1fr_360px]' : 'md:grid-cols-[280px_1fr]'

  return (
    <div className={`grid flex-1 overflow-hidden grid-cols-1 ${cols}`}>
      {/* StoreTree: hidden on mobile, visible on desktop */}
      <div className="hidden md:flex md:flex-col md:min-h-0">{tree}</div>

      {/* Main content + collapse handle on its right edge */}
      <div className="relative flex min-h-0 flex-col overflow-hidden">
        {content}
        {hasDetail && (
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? '店舗情報を隠す' : '店舗情報を表示'}
            title={open ? '店舗情報を隠す' : '店舗情報を表示'}
            className="absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 rounded-l border border-r-0 border-slate-300 bg-white/90 px-1 py-4 text-xs text-slate-500 shadow hover:bg-white md:block"
          >
            {open ? '▶' : '◀'}
          </button>
        )}
      </div>

      {/* Detail panel: hidden on mobile, collapsible on desktop */}
      {showDetail && (
        <div className="hidden md:flex md:flex-col md:min-h-0">{detail}</div>
      )}
    </div>
  )
}
