import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader, LinkBtn } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getT } from '@/lib/i18n/server'

interface Row {
  id: string
  name: string
  address: string | null
  area_code: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  edge_devices: { id: string; status: string }[]
}

export default async function StoresAdmin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; area?: string }>
}) {
  const { q, area } = await searchParams
  const supa = await createSupabaseServer()
  const t = await getT()
  const ts = t.adminStores

  // テナント文脈: tenant_admin=自テナント / super_admin=操作中テナント。
  // super_admin が未選択の間は全店舗を閲覧できるが、新規作成はできない
  // （選び間違いで他テナントに店舗を作る事故を防ぐ）。
  const ctx = await resolveAdminContext(supa)

  let query = supa
    .from('stores')
    .select(`
      id, name, address, area_code, latitude, longitude, is_active,
      edge_devices ( id, status )
    `)
    .order('name')
    .limit(500)
  // 店舗限定ロールは担当店舗のみ・テナントロールはテナント全体。
  if (ctx.storeIds) query = query.in('id', ctx.storeIds)
  else if (ctx.tenantId) query = query.eq('tenant_id', ctx.tenantId)
  if (q) query = query.ilike('name', `%${q}%`)
  if (area) query = query.eq('area_code', area)

  const { data } = await query
  const rows = (data ?? []) as Row[]

  return (
    <AdminShell pathname="/admin/stores" section="admin">
      <PageHeader
        title={ts.title}
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/stores', label: t.adminNav.stores }]}
        actions={
          <>
            {/* 新規作成はテナント確定時のみ（super_admin は操作中テナント選択が前提） */}
            {ctx.tenantId && <LinkBtn href="/admin/stores/new">＋ 新規店舗</LinkBtn>}
            <LinkBtn href="/admin/import">{ts.csvImportBtn}</LinkBtn>
          </>
        }
      />

      <form className="flex gap-2 border-b border-slate-200 bg-white px-5 py-3 text-xs">
        <input name="q" defaultValue={q ?? ''} placeholder={ts.searchPlaceholder}
               className="rounded border border-slate-200 px-2 py-1" />
        <input name="area" defaultValue={area ?? ''} placeholder={ts.areaPlaceholder}
               className="rounded border border-slate-200 px-2 py-1 w-32" />
        <button className="rounded bg-slate-700 px-3 py-1 text-white">{ts.filterBtn}</button>
      </form>

      <div className="px-5 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{ts.colName}</th>
                <th className="px-3 py-2 text-left">{ts.colAddress}</th>
                <th className="px-3 py-2 text-left">{ts.colArea}</th>
                <th className="px-3 py-2 text-left">{ts.colGeo}</th>
                <th className="px-3 py-2 text-left">{ts.colEdges}</th>
                <th className="px-3 py-2 text-left">{ts.colActive}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const status = s.edge_devices?.[0]?.status ?? t.common.dash
                const geo = s.latitude != null && s.longitude != null
                  ? `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`
                  : <span className="text-amber-600">{ts.notSet}</span>
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-slate-600">{s.address ?? t.common.dash}</td>
                    <td className="px-3 py-2">{s.area_code ?? t.common.dash}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{geo}</td>
                    <td className="px-3 py-2">{status}</td>
                    <td className="px-3 py-2">{s.is_active ? '○' : '×'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/stores/${s.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {ts.editLink}
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">{ts.empty}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length === 500 && (
          <p className="mt-2 text-xs text-slate-500">{ts.showingLimit}</p>
        )}
      </div>
    </AdminShell>
  )
}
