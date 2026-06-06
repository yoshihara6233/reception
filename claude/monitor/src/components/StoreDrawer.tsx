'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  edge_devices: { status: string }[] | null
}

interface Group {
  area: string
  stores: StoreRow[]
}

const STATUS_COLOR: Record<string, string> = {
  online:  '#22c55e',
  idle:    '#22c55e',
  grid:    '#3b82f6',
  live:    '#a855f7',
  vod:     '#f97316',
  error:   '#ef4444',
  offline: '#9ca3af',
}

export function StoreDrawer({
  open,
  onClose,
  groups,
  selectedId,
}: {
  open: boolean
  onClose: () => void
  groups: Group[]
  selectedId?: string
}) {
  const router = useRouter()
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        className={
          'fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden ' +
          (open ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={
          'fixed bottom-14 left-0 top-0 z-50 flex w-72 flex-col bg-slate-50 shadow-2xl transition-transform duration-300 md:hidden ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-3">
          <span className="text-sm font-bold text-slate-800">店舗を選択</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="閉じる"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Store list */}
        <div className="flex-1 overflow-y-auto pb-4 text-sm">
          {groups.map((g) => (
            <div key={g.area}>
              <div className="sticky top-0 bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {g.area}
              </div>
              {g.stores.map((store) => {
                const status = store.edge_devices?.[0]?.status ?? 'offline'
                const isSelected = store.id === selectedId
                return (
                  <button
                    key={store.id}
                    onClick={() => {
                      router.push(`/stores/${store.id}`)
                      onClose()
                    }}
                    className={
                      'flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors ' +
                      (isSelected
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-white')
                    }
                  >
                    <span
                      className="mt-px h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ background: STATUS_COLOR[status] ?? STATUS_COLOR.offline }}
                    />
                    <span className="truncate">{store.name}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
