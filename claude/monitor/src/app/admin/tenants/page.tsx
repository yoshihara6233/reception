import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader, LinkBtn } from '@/components/admin/PageHeader'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ActAsTenantButton } from './ActAsTenantButton'

interface Row {
  id: string
  name: string
  plan: string
  status: string
  slug: string | null
  created_at: string
  stores: { count: number }[]
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700',
  trial:     'bg-blue-50 text-blue-700',
  suspended: 'bg-amber-50 text-amber-700',
}

export default async function TenantsAdmin() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  // テナント管理は super_admin 専用。
  if (me?.role !== 'super_admin') notFound()

  // service client で全テナントを取得（RLS の tenant スコープに縛られないため）。
  const svc = createSupabaseService()
  const { data } = await svc
    .from('tenants')
    .select('id, name, plan, status, slug, created_at, stores(count)')
    .order('name')
  const rows = (data ?? []) as Row[]

  return (
    <AdminShell pathname="/admin/tenants" section="admin">
      <PageHeader
        title="テナント"
        crumb={[{ href: '/admin', label: 'マスタ' }, { href: '/admin/tenants', label: 'テナント' }]}
        actions={<LinkBtn href="/admin/tenants/new">＋ 新規テナント</LinkBtn>}
      />

      <div className="px-5 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">テナント名</th>
                <th className="px-3 py-2 text-left">プラン</th>
                <th className="px-3 py-2 text-left">ステータス</th>
                <th className="px-3 py-2 text-left">スラッグ</th>
                <th className="px-3 py-2 text-left">店舗数</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2">{t.plan}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] ${STATUS_BADGE[t.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{t.slug ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{t.stores?.[0]?.count ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <ActAsTenantButton tenantId={t.id} />
                      <Link href={`/admin/tenants/${t.id}`} className="text-blue-600 hover:underline">編集</Link>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">テナントがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}
