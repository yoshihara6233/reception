import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'

export default async function AdminHome() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const ta = t.adminDashboard

  const [stores, edges, recorders, cameras, online, offline] = await Promise.all([
    supa.from('stores').select('*', { count: 'exact', head: true }),
    supa.from('edge_devices').select('*', { count: 'exact', head: true }),
    supa.from('recorders').select('*', { count: 'exact', head: true }),
    supa.from('recorder_cameras').select('*', { count: 'exact', head: true }),
    supa.from('edge_devices').select('*', { count: 'exact', head: true }).neq('status', 'offline'),
    supa.from('edge_devices').select('*', { count: 'exact', head: true }).eq('status', 'offline'),
  ])

  const stats = [
    { label: ta.statStores,    val: stores.count    ?? 0, href: '/admin/stores'   },
    { label: ta.statEdges,     val: edges.count     ?? 0, href: '/admin/edges'    },
    { label: ta.statRecorders, val: recorders.count ?? 0, href: '/admin/edges' },
    { label: ta.statCameras,   val: cameras.count   ?? 0, href: '/admin/edges' },
    { label: ta.statOnline,    val: online.count    ?? 0, href: '/admin/edges?status=online'  },
    { label: ta.statOffline,   val: offline.count   ?? 0, href: '/admin/edges?status=offline', warn: true },
  ]

  return (
    <AdminShell pathname="/admin" section="admin">
      <PageHeader title={ta.title} />
      <div className="grid grid-cols-3 gap-4 p-5">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{s.label}</div>
            <div className={'mt-1 text-2xl font-bold ' + (s.warn ? 'text-red-600' : 'text-slate-900')}>
              {s.val.toLocaleString()}
            </div>
          </a>
        ))}
      </div>
    </AdminShell>
  )
}
