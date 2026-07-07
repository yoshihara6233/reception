/**
 * /admin/audit/footage — 映像閲覧アクセスログ（データガバナンス G3）
 *
 * 証跡静止画（発報スナップ / 発報前後フレーム / 巡回スナップ / BCPエクスポート）の
 * 閲覧アクセスを一覧する。ライブ/グリッド/VOD の閲覧セッションは /admin/audit（live_sessions）。
 * RLS: super_admin=全件 / tenant_admin=自テナントの店舗由来のみ（footage_access_log_select）。
 */
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'

interface Row {
  id: string
  actor_user_id: string
  store_id: string | null
  access_type: 'alarm_snapshot' | 'alarm_frame' | 'patrol_snapshot' | 'bcp_export'
  resource_id: string | null
  camera_id: string | null
  accessed_at: string
  stores: { name: string | null } | null
}

const TYPE_LABEL: Record<Row['access_type'], string> = {
  alarm_snapshot:  '発報スナップ',
  alarm_frame:     '発報フレーム',
  patrol_snapshot: '巡回スナップ',
  bcp_export:      'BCPエクスポート',
}
const TYPE_STYLE: Record<Row['access_type'], string> = {
  alarm_snapshot:  'bg-red-100 text-red-700',
  alarm_frame:     'bg-amber-100 text-amber-700',
  patrol_snapshot: 'bg-blue-100 text-blue-700',
  bcp_export:      'bg-violet-100 text-violet-700',
}

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

export default async function FootageAccessAuditPage() {
  const supa = await createSupabaseServer()
  const { data } = await supa
    .from('footage_access_log')
    .select('id, actor_user_id, store_id, access_type, resource_id, camera_id, accessed_at, stores ( name )')
    .order('accessed_at', { ascending: false })
    .limit(300)
  const rows = (data ?? []) as unknown as Row[]

  return (
    <AdminShell pathname="/admin/audit/footage" section="admin">
      <PageHeader title="映像閲覧アクセスログ（証跡）" />
      <div className="p-5">
        <div className="mb-3 flex items-center gap-3 text-xs text-slate-500">
          <Link href="/admin/audit" className="text-blue-600 hover:underline">← ライブ/VOD 閲覧履歴（セッション）</Link>
          <span>証跡静止画のアクセスを記録（5分単位で集約・保持180日）。</span>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            アクセス記録はまだありません。
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">アクセス日時</th>
                  <th className="px-3 py-2 text-left">種別</th>
                  <th className="px-3 py-2 text-left">店舗</th>
                  <th className="px-3 py-2 text-left">操作者</th>
                  <th className="px-3 py-2 text-left">対象</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 tabular-nums text-slate-700">{fmtJst(r.accessed_at)}</td>
                    <td className="px-3 py-2">
                      <span className={'rounded px-1.5 py-px text-[10px] font-bold ' + TYPE_STYLE[r.access_type]}>
                        {TYPE_LABEL[r.access_type]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.stores?.name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.actor_user_id.slice(0, 8)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.resource_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
