'use client'

import { useState } from 'react'
import { AppHeader } from './AppHeader'
import { BottomNav } from './BottomNav'
import { StoreDrawer } from './StoreDrawer'
// LangProvider has moved to the root layout so admin/security/bcp/infra pages
// also get the language context — previously only routes using AppShellClient
// had a provider, which made setLang() a no-op everywhere else.

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  edge_devices: { id: string; status: string; last_seen_at: string | null }[] | null
}

interface Group {
  area: string
  stores: StoreRow[]
}

export function AppShellClient({
  userName,
  groups,
  selectedStoreId,
  children,
  features,
  tenantName,
  isSuper,
  role,
  feedbackEntry,
}: {
  userName: string
  groups: Group[]
  selectedStoreId?: string
  children: React.ReactNode
  features?: { patrol: boolean; alarm: boolean; baggage: boolean }
  tenantName?: string | null
  isSuper?: boolean
  /** 自分の役割 (入口の出し分け用・2026-11-04・シナリオ試験の所見) */
  role?: string | null
  feedbackEntry?: boolean
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div
      className="flex flex-col bg-slate-50 text-slate-900"
      style={{
        height: '100dvh',            // dynamic viewport height (handles mobile browser chrome)
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Top header */}
      <AppHeader userName={userName} onMenuClick={() => setDrawerOpen(true)} features={features} tenantName={tenantName} isSuper={isSuper} role={role} feedbackEntry={feedbackEntry} />

      {/* Scrollable middle area; on mobile adds bottom padding for nav bar */}
      <div className="flex flex-1 flex-col overflow-hidden pb-0 md:pb-0">
        {children}
      </div>

      {/* Bottom nav — mobile only (rendered via CSS hidden md:hidden in BottomNav) */}
      <BottomNav />

      {/* Mobile slide-in store drawer */}
      <StoreDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        groups={groups}
        selectedId={selectedStoreId}
      />
    </div>
  )
}
