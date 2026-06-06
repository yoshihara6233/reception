import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { MapWithToggle } from './MapWithToggle'

export default async function MapPage() {
  const supa = await createSupabaseServer()
  const { data: stores } = await supa
    .from('stores')
    .select(`
      id, name, address, latitude, longitude, area_code,
      edge_devices ( id, status, last_seen_at )
    `)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(10_000)

  return (
    <AppShell showDetail={false}>
      <main className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs">
          <div className="text-slate-600">地図表示</div>
          <div className="text-slate-500">{stores?.length ?? 0} 店舗</div>
        </div>
        <div className="flex-1">
          {/* F26: client wrapper with alert-zoom toggle */}
          <MapWithToggle stores={(stores ?? []) as never} />
        </div>
      </main>
    </AppShell>
  )
}
