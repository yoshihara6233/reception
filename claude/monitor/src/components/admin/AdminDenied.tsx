import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'

/**
 * 管理画面の「権限がありません」表示。認証済みだが必要ロールに満たない時に使う
 * （生の 404=notFound ではなく、AdminShell 付きで分かりやすく案内する）。
 * 未認証(401)の場合はページ側で redirect('/login') すること。
 */
export function AdminDenied({
  pathname,
  title = 'アクセス権限がありません',
  // 内部名 (super_admin) を出さず、案内先はテナントの管理者にする。権限を付けるのは
  // テナントの管理者で、運営ではない (2026-11-04・シナリオ試験の所見)
  message = 'この画面を表示する権限がありません。必要な場合はテナントの管理者にお問い合わせください。',
}: {
  pathname: string
  title?: string
  message?: string
}) {
  return (
    <AdminShell pathname={pathname} section="admin">
      <PageHeader title={title} />
      <div className="p-5 text-sm text-slate-600 dark:text-gedink2">{message}</div>
    </AdminShell>
  )
}
