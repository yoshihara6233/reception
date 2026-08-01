/**
 * /admin/audit/changes — 設定変更の監査ログ（admin_audit_log）
 *
 * recorder / camera / edge のライブ/VOD/go2rtc 設定変更を「誰が・いつ・何を」表示。
 * RLS(admin_audit_log_select)に従い super_admin=全件 / tenant_admin・store_manager=自店舗。
 * 視聴履歴(live_sessions)は /admin/audit に分離。
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'

interface ChangeRow {
  id: number
  ts: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  store_id: string | null
  changes: unknown
  stores: { name: string } | null
}

const ACTION_STYLE: Record<string, string> = {
  'recorder.create':  'bg-emerald-100 text-emerald-700',
  'recorder.update':  'bg-blue-100 text-blue-700',
  'recorder.delete':  'bg-red-100 text-red-700',
  'recorder.cameras': 'bg-violet-100 text-violet-700',
  'edge.update':      'bg-amber-100 text-amber-700',
  'edge.create':      'bg-emerald-100 text-emerald-700',
  'user.create':      'bg-emerald-100 text-emerald-700',
  'user.update':      'bg-blue-100 text-blue-700',
  'user.delete':      'bg-red-100 text-red-700',
  'store.update':     'bg-blue-100 text-blue-700',
  'store.import':     'bg-violet-100 text-violet-700',
  'camera.import':    'bg-violet-100 text-violet-700',
}

function fmtJST(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function shortUuid(id: string | null) {
  return id ? id.slice(0, 8) + '…' : '—'
}

const PAGE_SIZE = 100

export default async function AuditChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // SaaS運営者（super_admin）の設定変更はテナント側に見せない。
  // クエリ段階で actor を除外し、ページング件数も正しく保つ。
  const ctx = await resolveAdminContext(supa)
  let query = supa
    .from('admin_audit_log')
    .select('id, ts, actor_user_id, action, target_type, target_id, store_id, changes, stores ( name )', { count: 'exact' })
    .order('ts', { ascending: false })
  if (ctx.role !== 'super_admin') {
    const svc = createSupabaseService()
    const { data: supers } = await svc.from('admin_users').select('auth_user_id').eq('role', 'super_admin')
    const superIds = (supers ?? []).map((s) => s.auth_user_id as string)
    if (superIds.length) query = query.not('actor_user_id', 'in', `(${superIds.join(',')})`)
  }
  const { data, count } = await query.range(offset, offset + PAGE_SIZE - 1)

  const rows = (data ?? []) as unknown as ChangeRow[]
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <AdminShell pathname="/admin/audit" section="admin">
      <PageHeader
        title="設定変更ログ"
        crumb={[
          { href: '/admin',        label: 'マスタ' },
          { href: '/admin/audit',  label: '監査ログ' },
          { href: '/admin/audit/changes', label: '設定変更' },
        ]}
      />

      <div className="space-y-4 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
            設定変更 {count ?? 0} 件（レコーダ / カメラ / エッジ / 店舗 / ユーザ / 設定）
          </div>
          <Link href="/admin/audit" className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            ← 視聴ログ
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 text-center">
            <p className="text-sm font-medium text-slate-600">変更履歴はまだありません</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">日時</th>
                  <th className="px-3 py-2 text-left">操作者</th>
                  <th className="px-3 py-2 text-left">操作</th>
                  <th className="px-3 py-2 text-left">店舗</th>
                  <th className="px-3 py-2 text-left">対象</th>
                  <th className="px-3 py-2 text-left">変更内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-600">{fmtJST(row.ts)}</td>
                    <td className="px-3 py-2 font-mono text-slate-400" title={row.actor_user_id ?? ''}>{shortUuid(row.actor_user_id)}</td>
                    <td className="px-3 py-2">
                      <span className={'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' + (ACTION_STYLE[row.action] ?? 'bg-slate-100 text-slate-600')}>
                        {row.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.stores?.name ?? <span className="text-slate-400">{shortUuid(row.store_id)}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {row.target_type}<br />{shortUuid(row.target_id)}
                    </td>
                    <td className="px-3 py-2">
                      <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600">
                        {row.changes ? JSON.stringify(row.changes, null, 1) : '—'}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-[11px] text-slate-500">{page} / {totalPages}</span>
                <div className="flex gap-1">
                  {page > 1 && (
                    <a href={`/admin/audit/changes?page=${page - 1}`} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-100">前へ</a>
                  )}
                  {page < totalPages && (
                    <a href={`/admin/audit/changes?page=${page + 1}`} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-100">次へ</a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
