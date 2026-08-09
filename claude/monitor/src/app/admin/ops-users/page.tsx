/**
 * ②運営管理 → システム管理者（super_admin）の一覧。
 *
 * super_admin はテナントに属さない運営側の存在なので、テナント文脈で動く
 * ①設定「ユーザーマスタ」(/admin/users) からは除外し、ここに分けた。
 * ①側で操作中テナント未選択のときに tenant=— の行が混じって見えるのを止めるのが目的。
 *
 * 権限モデルは [[monitor-admin-authz-model]] に従う。②のページ・API・server action は
 * すべて super_admin ゲート必須（メニューで隠すだけでは直 URL で到達される）。
 */
import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { UserDeleteButton } from '../users/user-actions'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  email: string
  display_name: string | null
  auth_user_id: string | null
  created_at: string
}

export default async function OpsUsersPage() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return <AdminDenied pathname="/admin/ops-users" />

  // service client：super_admin 行はテナントに紐づかず RLS の絞り込み対象外のため。
  const svc = createSupabaseService()
  const { data } = await svc
    .from('admin_users')
    .select('id, email, display_name, auth_user_id, created_at')
    .eq('role', 'super_admin')
    .order('display_name')

  const rows = (data ?? []) as Row[]
  // 最後の 1 人は消させない。API 側でも 409 で弾くが（lib/admin/super-admin-floor）、
  // 押せてしまうボタンを出さないほうが親切。
  const isLastOne = rows.length <= 1

  return (
    <AdminShell pathname="/admin/ops-users" section="admin">
      <PageHeader
        title="システム管理者"
        crumb={[
          { href: '/admin', label: 'マスタ' },
          { href: '/admin/ops-users', label: 'システム管理者' },
        ]}
        actions={
          <Link
            href="/admin/ops-users/new"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            ＋ 新規作成
          </Link>
        }
      />

      <div className="px-5 py-5">
        <p className="mb-4 text-xs leading-relaxed text-slate-600">
          テナントに属さない運営側の管理者です。テナントの作成、エッジサーバの登録、視聴上限、
          運営アクセスログを扱えます。テナント配下のユーザーは
          <Link href="/admin/users" className="mx-1 text-blue-700 underline">ユーザーマスタ</Link>
          で管理してください。
        </p>

        {isLastOne && rows.length === 1 && (
          <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            システム管理者が 1 名のみです。この 1 名は削除できません。
            交代する場合は、先に新しいシステム管理者を作成してください。
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">名前</th>
                <th className="px-4 py-2 font-medium">メールアドレス</th>
                <th className="px-4 py-2 font-medium">ログイン</th>
                <th className="px-4 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                    システム管理者がいません。
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {r.display_name || '（名称未設定）'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.email}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {r.auth_user_id ? '有効' : '未連携'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/ops-users/${r.id}`}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        編集
                      </Link>
                      {isLastOne ? (
                        <span
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-400"
                          title="システム管理者が 0 名になるため削除できません"
                        >
                          削除不可
                        </span>
                      ) : (
                        <UserDeleteButton id={r.id} name={r.display_name || r.email} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}
