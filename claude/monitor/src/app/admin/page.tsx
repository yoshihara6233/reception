import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { missingCriticalEnv } from '@/lib/ops/env-check'

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

  // 是正5: 本番 env の設定漏れ警告（値は表示しない・欠落キーと影響のみ）。
  // CRON_SECRET / ALERT_EMAILS 等は未設定でも黙って機能停止するため、ここで可視化する。
  const missingEnv = missingCriticalEnv()

  return (
    <AdminShell pathname="/admin" section="admin">
      <PageHeader title={ta.title} />
      {missingEnv.length > 0 && (
        <div className="mx-5 mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">環境変数の設定漏れ（Vercel → Settings → Environment Variables）</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {missingEnv.map((i) => (
              <li key={i.key} className="flex items-baseline gap-2">
                <span className={'rounded px-1.5 py-px text-[10px] font-bold ' + (i.required ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                  {i.required ? '必須' : '推奨'}
                </span>
                <code className="font-mono font-semibold">{i.key}</code>
                <span className="text-slate-500">— {i.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
