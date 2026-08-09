/**
 * ②運営管理 → システム管理者の編集。super_admin ゲート必須。
 *
 * ここで扱うのは super_admin 行のみ。テナント配下のユーザーを開こうとしたら 404 に
 * して、①設定の /admin/users へ誘導する（面を混ぜない）。
 */
import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { countSuperAdmins } from '@/lib/admin/super-admin-floor'
import { UserForm, type Role } from '../../users/user-form'

export const dynamic = 'force-dynamic'

export default async function EditOpsUserPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return <AdminDenied pathname="/admin/ops-users" />

  const { id } = await params
  const svc = createSupabaseService()

  const { data: target } = await svc
    .from('admin_users')
    .select('id, email, display_name, role, tenant_id, store_ids')
    .eq('id', id)
    .single()
  if (!target) notFound()

  // この面は super_admin 専用。テナント側ユーザーはここでは編集させない。
  if ((target as { role: string }).role !== 'super_admin') notFound()

  const isLastOne = (await countSuperAdmins(svc)) <= 1

  return (
    <AdminShell pathname="/admin/ops-users" section="admin">
      <PageHeader
        title={`システム管理者: ${(target as { display_name: string | null }).display_name ?? (target as { email: string }).email}`}
        crumb={[
          { href: '/admin', label: 'マスタ' },
          { href: '/admin/ops-users', label: 'システム管理者' },
          { href: `/admin/ops-users/${id}`, label: '編集' },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        {isLastOne && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            現在のシステム管理者はこの 1 名だけです。ロールを変更すると誰も運営管理へ到達
            できなくなるため、保存時に拒否されます。先に別のシステム管理者を作成してください。
          </p>
        )}
        <UserForm
          mode="edit"
          id={id}
          initial={{
            email:        (target as { email: string }).email,
            display_name: (target as { display_name: string | null }).display_name ?? '',
            role:         (target as { role: Role }).role,
            tenant_id:    null,
            store_ids:    [],
          }}
          tenants={[]}
          stores={[]}
          canCreateSuperAdmin
        />
      </div>
    </AdminShell>
  )
}
