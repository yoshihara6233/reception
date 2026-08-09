/**
 * ②運営管理 → システム管理者の新規作成。super_admin ゲート必須。
 * フォームは ①設定 と同じ UserForm を使い回す（保存先も /api/admin/users で共通）。
 */
import { AdminShell } from '@/components/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { UserForm } from '../../users/user-form'

export const dynamic = 'force-dynamic'

export default async function NewOpsUserPage() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return <AdminDenied pathname="/admin/ops-users" />

  return (
    <AdminShell pathname="/admin/ops-users" section="admin">
      <PageHeader
        title="システム管理者 新規作成"
        crumb={[
          { href: '/admin', label: 'マスタ' },
          { href: '/admin/ops-users', label: 'システム管理者' },
          { href: '/admin/ops-users/new', label: '新規作成' },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          テナントに属さない運営側の管理者を作成します。テナント配下のユーザーを作る場合は
          ユーザーマスタから行ってください。
        </p>
        <UserForm
          mode="create"
          initial={{
            email:        '',
            display_name: '',
            role:         'super_admin',
            tenant_id:    null,   // super_admin はテナントを持たない
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
