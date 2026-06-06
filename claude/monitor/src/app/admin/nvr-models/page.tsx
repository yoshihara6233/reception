/**
 * F49.J: /admin/nvr-models — NVR 機種マスタ管理
 *
 * 機種一覧 + 編集。i-PRO 公式の EOL/EOS 情報が更新されたとき、管理者が
 * 手動で反映する画面。stores テーブルの nvr_eol_date / nvr_eos_date は
 * トリガで自動同期される。
 */
import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { NvrModelsRow } from '@/lib/supabase/db-types'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function fmtEosBadge(eosDate: string | null): { label: string; style: string } {
  if (!eosDate) return { label: '未設定', style: 'bg-slate-100 text-slate-500' }
  const months = Math.round((new Date(eosDate).getTime() - Date.now()) / (30 * 86400_000))
  if (months < 0)  return { label: `${Math.abs(months)}ヶ月超過`, style: 'bg-red-600 text-white' }
  if (months < 12) return { label: `あと${months}ヶ月`, style: 'bg-red-100 text-red-700' }
  if (months < 24) return { label: `あと${months}ヶ月`, style: 'bg-yellow-100 text-yellow-700' }
  return { label: `あと${months}ヶ月`, style: 'bg-emerald-100 text-emerald-700' }
}

export default async function AdminNvrModelsPage(
  { searchParams }: { searchParams: Promise<{ vendor?: string }> },
) {
  const { vendor } = await searchParams
  const supa = await createSupabaseServer()

  let query = supa.from('nvr_models')
    .select('*')
    .order('vendor')
    .order('model_number')
  if (vendor) query = query.eq('vendor', vendor)
  const { data } = await query
  const models = ((data ?? []) as unknown as NvrModelsRow[])

  // ベンダー別に件数集計
  const vendorCounts = new Map<string, number>()
  for (const m of models) {
    vendorCounts.set(m.vendor, (vendorCounts.get(m.vendor) ?? 0) + 1)
  }

  return (
    <AdminShell pathname="/admin/nvr-models" section="admin">
      <PageHeader
        title="NVR 機種マスタ"
        crumb={[
          { href: '/admin',            label: '設定' },
          { href: '/admin/nvr-models', label: 'NVR 機種' },
        ]}
      />

      <div className="px-5 py-4 space-y-4">
        {/* フィルタ */}
        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">ベンダー:</span>
          <Link
            href="/admin/nvr-models"
            className={'rounded px-2 py-1 ' + (vendor ? 'bg-slate-100 text-slate-700' : 'bg-slate-800 text-white')}
          >
            すべて ({models.length})
          </Link>
          {[...vendorCounts.entries()].map(([v, count]) => (
            <Link
              key={v}
              href={`/admin/nvr-models?vendor=${v}`}
              className={'rounded px-2 py-1 ' + (vendor === v ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
            >
              {v} ({count})
            </Link>
          ))}
        </nav>

        {/* テーブル */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">ベンダー</th>
                <th className="px-3 py-2 text-left">機種番号</th>
                <th className="px-3 py-2 text-left">表示名</th>
                <th className="px-3 py-2 text-right">CH</th>
                <th className="px-3 py-2 text-left">解像度</th>
                <th className="px-3 py-2 text-left">発売</th>
                <th className="px-3 py-2 text-left">EOL</th>
                <th className="px-3 py-2 text-left">EOS</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const badge = fmtEosBadge(m.eos_date)
                return (
                  <tr key={m.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">{m.vendor}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">{m.model_number}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{m.display_name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{m.max_channels ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{m.max_resolution ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{fmtDate(m.released_at)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{fmtDate(m.eol_date)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-mono text-[11px]">{fmtDate(m.eos_date)}</span>
                        <span className={'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ' + badge.style}>
                          {badge.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/nvr-models/${m.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {models.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">機種が登録されていません</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 説明 */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          <strong>使い方:</strong> ベンダー公式の EOL/EOS 情報が更新されたとき、対応する機種行の「編集」から日付を更新してください。
          各店舗の <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/40">nvr_eos_date</code> はトリガで自動同期されます。
        </div>
      </div>
    </AdminShell>
  )
}
