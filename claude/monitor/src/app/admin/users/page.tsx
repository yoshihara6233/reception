/**
 * /admin/users — ユーザーマスタ
 *
 * admin_users を一覧表示。ロール・名前・メールで絞り込み可能。
 * auth_user_id が紐付いていれば「認証済み」として表示する。
 */
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

interface Row {
  id: string
  email: string
  name: string
  role: string
  store_ids: string[]
  auth_user_id: string | null
  created_at: string
  tenants: { id: string; name: string } | null
}

const ROLE_STYLE: Record<string, string> = {
  super_admin:   'bg-red-100 text-red-700',
  tenant_admin:  'bg-violet-100 text-violet-700',
  store_manager: 'bg-blue-100 text-blue-700',
  viewer:        'bg-slate-100 text-slate-600',
}

function roleLabel(r: string, u: Msg['adminUsers']): string {
  switch (r) {
    case 'super_admin':   return u.roleSuperAdmin
    case 'tenant_admin':  return u.roleTenantAdmin
    case 'store_manager': return u.roleStoreManager
    case 'viewer':        return u.roleViewer
    default:              return r
  }
}

export default async function UsersAdmin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>
}) {
  const { q, role } = await searchParams
  const supa = await createSupabaseServer()
  const t = await getT()
  const tu = t.adminUsers

  let query = supa
    .from('admin_users')
    .select(`
      id, email, name, role, store_ids, auth_user_id, created_at,
      tenants ( id, name )
    `)
    .order('name')
    .limit(500)

  if (q) {
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`)
  }
  if (role && ['super_admin', 'tenant_admin', 'store_manager', 'viewer'].includes(role)) {
    query = query.eq('role', role)
  }

  const { data } = await query
  const rows = (data ?? []) as unknown as Row[]

  return (
    <AdminShell pathname="/admin/users" section="admin">
      <PageHeader
        title={tu.title}
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/users', label: t.adminNav.users }]}
      />

      {/* Search / filter bar */}
      <form className="flex flex-wrap gap-2 border-b border-slate-200 bg-white px-5 py-3 text-xs">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder={tu.searchPlaceholder}
          className="rounded border border-slate-200 px-2 py-1 w-52"
        />
        <select
          name="role"
          defaultValue={role ?? ''}
          className="rounded border border-slate-200 px-2 py-1"
        >
          <option value="">{tu.allRoles}</option>
          <option value="super_admin">{tu.roleSuperAdmin}</option>
          <option value="tenant_admin">{tu.roleTenantAdmin}</option>
          <option value="store_manager">{tu.roleStoreManager}</option>
          <option value="viewer">{tu.roleViewer}</option>
        </select>
        <button className="rounded bg-slate-700 px-3 py-1 text-white">{tu.filterBtn}</button>
        {(q || role) && (
          <a href="/admin/users" className="rounded border border-slate-200 bg-white px-3 py-1 text-slate-500 hover:bg-slate-100">
            {tu.clearBtn}
          </a>
        )}
      </form>

      <div className="px-5 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{tu.colName}</th>
                <th className="px-3 py-2 text-left">{tu.colEmail}</th>
                <th className="px-3 py-2 text-left">{tu.colRole}</th>
                <th className="px-3 py-2 text-left">{tu.colTenant}</th>
                <th className="px-3 py-2 text-left">{tu.colStoreCount}</th>
                <th className="px-3 py-2 text-left">{tu.colAuth}</th>
                <th className="px-3 py-2 text-left">{tu.colCreated}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">{u.name}</td>
                  <td className="px-3 py-2 text-slate-600">{u.email}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' +
                        (ROLE_STYLE[u.role] ?? 'bg-slate-100 text-slate-600')
                      }
                    >
                      {roleLabel(u.role, tu)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {u.tenants?.name ?? t.common.dash}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">
                    {u.role === 'super_admin' || u.role === 'tenant_admin'
                      ? <span className="text-slate-400">{tu.allStores}</span>
                      : (u.store_ids?.length ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    {u.auth_user_id ? (
                      <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {tu.authVerified}
                      </span>
                    ) : (
                      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        {tu.authNotLinked}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {new Date(u.created_at).toLocaleDateString('ja-JP', {
                      timeZone: 'Asia/Tokyo',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    {tu.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length === 500 && (
          <p className="mt-2 text-xs text-slate-500">{tu.showingLimit}</p>
        )}
      </div>
    </AdminShell>
  )
}
