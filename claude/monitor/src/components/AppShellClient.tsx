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
  edge_devices: { status: string }[] | null
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
}: {
  userName: string
  groups: Group[]
  selectedStoreId?: string
  children: React.ReactNode
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
      <AppHeader userName={userName} onMenuClick={() => setDrawerOpen(true)} />

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
