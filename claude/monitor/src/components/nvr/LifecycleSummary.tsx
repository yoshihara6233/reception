/**
 * F48.D: /infra ライフサイクル サマリカード
 *
 * v_nvr_lifecycle_summary VIEW の集計結果を表示。
 * モニタリング担当者でも「機材寿命の全体感」を把握できるようにする
 * (詳細は管理者のみが /admin で操作)。
 */
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { NvrLifecycleStatus } from '@intereco/shared'

interface SummaryRow {
  lifecycle_status: NvrLifecycleStatus
  store_count:      number
}

const STATUS_LABEL: Record<NvrLifecycleStatus, { label: string; emoji: string; color: string }> = {
  nvr_lifecycle_eos:              { label: 'EOS 超過',         emoji: '⛔', color: 'bg-red-600 text-white' },
  nvr_lifecycle_overage:          { label: '7年運用超過',      emoji: '⛔', color: 'bg-red-600 text-white' },
  nvr_lifecycle_urgent:           { label: '緊急 (6ヶ月以内)', emoji: '🔴', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  nvr_lifecycle_replace_planned:  { label: '置換計画推奨',     emoji: '🟠', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  nvr_lifecycle_warning:          { label: '24ヶ月以内 EOS',   emoji: '🟡', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  nvr_lifecycle_ok:               { label: 'サポート期間中',   emoji: '🟢', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  nvr_lifecycle_unknown:          { label: '未設定/不明',      emoji: '⚪', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

const STATUS_ORDER: NvrLifecycleStatus[] = [
  'nvr_lifecycle_eos',
  'nvr_lifecycle_overage',
  'nvr_lifecycle_urgent',
  'nvr_lifecycle_replace_planned',
  'nvr_lifecycle_warning',
  'nvr_lifecycle_ok',
  'nvr_lifecycle_unknown',
]

export async function LifecycleSummary() {
  const supa = await createSupabaseServer()
  let rows: SummaryRow[] = []
  try {
    const { data } = await supa
      .from('v_nvr_lifecycle_summary')
      .select('lifecycle_status, store_count')
    rows = ((data ?? []) as unknown as SummaryRow[])
  } catch {
    // VIEW 未作成: 空表示
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          機材ライフサイクル
        </h3>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          まだ NVR 機種・導入日が登録されている店舗がありません。
        </p>
      </div>
    )
  }

  // インデックス化
  const byStatus = new Map<NvrLifecycleStatus, number>()
  for (const r of rows) byStatus.set(r.lifecycle_status, r.store_count)

  const total = rows.reduce((sum, r) => sum + r.store_count, 0)
  const critical = (byStatus.get('nvr_lifecycle_eos') ?? 0)
                 + (byStatus.get('nvr_lifecycle_overage') ?? 0)
                 + (byStatus.get('nvr_lifecycle_urgent') ?? 0)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          機材ライフサイクル <span className="ml-1 text-xs font-normal text-slate-500">({total.toLocaleString()} 店舗)</span>
        </h3>
        {critical > 0 && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">
            要対応 {critical.toLocaleString()} 店
          </span>
        )}
      </div>

      <ul className="space-y-1 text-xs">
        {STATUS_ORDER.filter((s) => byStatus.has(s)).map((status) => {
          const count = byStatus.get(status) ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const meta = STATUS_LABEL[status]
          return (
            <li key={status} className="flex items-center gap-2">
              <span className={`inline-flex w-7 justify-center rounded text-[11px] font-semibold ${meta.color}`}>
                {meta.emoji}
              </span>
              <span className="flex-1 text-slate-700 dark:text-slate-300">{meta.label}</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {count.toLocaleString()}
              </span>
              <span className="w-10 text-right text-[10px] text-slate-400">{pct}%</span>
            </li>
          )
        })}
      </ul>

      <Link
        href="/admin/stores"
        className="mt-3 inline-block text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        詳細管理 →
      </Link>
    </div>
  )
}
