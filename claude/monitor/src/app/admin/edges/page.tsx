import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader, LinkBtn } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'

interface Row {
  id: string
  name: string
  status: string
  agent_version: string | null
  last_seen_at: string | null
  stores: { id: string; name: string; area_code: string | null } | null
  recorders: { id: string }[]
}

const STATUS_STYLE: Record<string, string> = {
  online:  'bg-emerald-100 text-emerald-700',
  idle:    'bg-emerald-100 text-emerald-700',
  grid:    'bg-blue-100 text-blue-700',
  live:    'bg-violet-100 text-violet-700',
  vod:     'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
  offline: 'bg-slate-200 text-slate-600',
}

export default async function EdgesAdmin({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  const supa = await createSupabaseServer()
  const t = await getT()
  const te = t.adminEdges

  let query = supa
    .from('edge_devices')
    .select(`
      id, name, status, agent_version, last_seen_at,
      stores ( id, name, area_code ),
      recorders ( id )
    `)
    .order('name')
    .limit(500)
  if (status) query = query.eq('status', status)
  if (q)      query = query.ilike('name', `%${q}%`)

  const { data } = await query
  const rows = (data ?? []) as never as Row[]

  return (
    <AdminShell pathname="/admin/edges" section="admin">
      <PageHeader
        title={te.title}
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/edges', label: t.adminNav.edges }]}
        actions={<LinkBtn href="/admin/edges/new" variant="primary">{te.addBtn}</LinkBtn>}
      />

      <form className="flex gap-2 border-b border-slate-200 bg-white px-5 py-3 text-xs">
        <input name="q" defaultValue={q ?? ''} placeholder={te.searchPlaceholder}
               className="rounded border border-slate-200 px-2 py-1" />
        <select name="status" defaultValue={status ?? ''}
                className="rounded border border-slate-200 px-2 py-1">
          <option value="">{te.allStatuses}</option>
          <option value="online">online</option>
          <option value="idle">idle</option>
          <option value="grid">grid</option>
          <option value="live">live</option>
          <option value="vod">vod</option>
          <option value="error">error</option>
          <option value="offline">offline</option>
        </select>
        <button className="rounded bg-slate-700 px-3 py-1 text-white">{te.filterBtn}</button>
      </form>

      <div className="px-5 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{te.colName}</th>
                <th className="px-3 py-2 text-left">{te.colStore}</th>
                <th className="px-3 py-2 text-left">{te.colArea}</th>
                <th className="px-3 py-2 text-left">{te.colStatus}</th>
                <th className="px-3 py-2 text-left">{te.colVersion}</th>
                <th className="px-3 py-2 text-left">{te.colRecorders}</th>
                <th className="px-3 py-2 text-left">{te.colLastSeen}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{e.name}</td>
                  <td className="px-3 py-2">{e.stores?.name ?? t.common.dash}</td>
                  <td className="px-3 py-2">{e.stores?.area_code ?? t.common.dash}</td>
                  <td className="px-3 py-2">
                    <span className={'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' + (STATUS_STYLE[e.status] ?? 'bg-slate-200 text-slate-600')}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{e.agent_version ?? t.common.dash}</td>
                  <td className="px-3 py-2">{e.recorders?.length ?? 0}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {e.last_seen_at ? new Date(e.last_seen_at).toLocaleString('ja-JP') : t.common.dash}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/edges/${e.id}`} className="text-blue-600 hover:underline">{te.editLink}</Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">{te.empty}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}
