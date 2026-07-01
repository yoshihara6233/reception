/**
 * /security — 今すぐ巡回ランチャー
 *
 * 全店舗を県（area_code）毎にグループ表示し、複数選択（県一括も）して一括で「今すぐ巡回」を
 * 発火する専用ページ。巡回結果（証跡・PDF）は /security/reports で確認する。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { PatrolLauncher, type LauncherGroup } from './PatrolLauncher'
import { prefLabel } from '@/lib/jp-prefectures'
import { getT } from '@/lib/i18n/server'

interface StoreRow { id: string; name: string; area_code: string | null }

export default async function SecurityPage() {
  const supa = await createSupabaseServer()
  const t = await getT()

  const { data: storeRows } = await supa
    .from('stores')
    .select('id, name, area_code')
    .eq('is_active', true)
    .order('area_code', { ascending: true, nullsFirst: false })
    .order('name')
    .limit(10_000)

  const stores = (storeRows ?? []) as StoreRow[]

  // 県（area_code）毎にグループ化。
  const map = new Map<string, LauncherGroup>()
  for (const s of stores) {
    const code = s.area_code ?? '—'
    let g = map.get(code)
    if (!g) { g = { code, label: prefLabel(s.area_code), stores: [] }; map.set(code, g) }
    g.stores.push({ id: s.id, name: s.name })
  }
  const groups = [...map.values()]

  return (
    <AdminShell pathname="/security" section="security">
      <PageHeader
        title={t.securityTriage.title}
        crumb={[{ href: '/security', label: t.breadcrumb.security }]}
      />
      <div className="px-5 py-4">
        <PatrolLauncher groups={groups} />
      </div>
    </AdminShell>
  )
}
