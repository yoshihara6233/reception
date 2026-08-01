/**
 * Left-side store tree: collapsible by area_code, store status dots.
 * Accepts pre-fetched groups from AppShell so the parent's query is reused
 * instead of running a duplicate SELECT on every navigation.
 */
import { TreeClient } from './StoreTreeClient'

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  edge_devices: { status: string; last_seen_at: string | null }[] | null
}

interface Group {
  area: string
  stores: StoreRow[]
}

export function StoreTree({
  selectedId,
  groups,
  alertStoreIds = [],
  alertGroups = [],
}: {
  selectedId?: string
  groups: Group[]
  alertStoreIds?: string[]
  /** 地震（Jアラート発令）単位のグループ。群発時の絞り込み用。 */
  alertGroups?: { key: string; label: string; storeIds: string[] }[]
}) {
  const totalStores = groups.reduce((n, g) => n + g.stores.length, 0)

  return (
    <aside className="flex flex-1 min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        <span>店舗ツリー</span>
        <span className="font-mono text-slate-900">{totalStores}</span>
      </div>
      <TreeClient groups={groups} selectedId={selectedId} alertStoreIds={alertStoreIds} alertGroups={alertGroups} />
    </aside>
  )
}
