/**
 * F46.27: 機材ライフサイクル カード
 *
 * v_store_nvr_lifecycle ビューの結果を可視化。
 * - 導入日 / EOL / EOS / 7年運用期限を一覧表示
 * - 残月数 + 進捗バー
 * - 状態バッジ (ok / warning / urgent / eos)
 *
 * F40.4 教訓: 関数値メッセージを使わず、lang ベースのインライン format。
 */
import type {
  StoreNvrLifecycle, NvrLifecycleStatus,
} from '@/lib/nvr-adapter/types'

interface Props {
  lifecycle: StoreNvrLifecycle
  lang?: string
}

export function LifecycleCard({ lifecycle, lang = 'ja' }: Props) {
  const styleClass = STATUS_STYLE[lifecycle.lifecycleStatus]
  const statusLabel = STATUS_LABEL[lifecycle.lifecycleStatus][lang as 'ja' | 'en'] ??
                      STATUS_LABEL[lifecycle.lifecycleStatus].ja
  const progress = computeProgress(lifecycle)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          機材ライフサイクル
        </h3>
        <span className={
          'rounded px-2 py-0.5 text-[11px] font-semibold ' + styleClass
        }>
          {statusLabel}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <dt className="text-slate-500 dark:text-slate-400">機種</dt>
        <dd className="font-mono text-slate-800 dark:text-slate-200">
          {lifecycle.nvrModel ?? '—'}
        </dd>

        <dt className="text-slate-500 dark:text-slate-400">導入日</dt>
        <dd className="font-mono text-slate-800 dark:text-slate-200">
          {fmtDate(lifecycle.installedAt)}
          {lifecycle.yearsInService != null && (
            <span className="ml-2 text-slate-400">
              ({fmtYears(lang, lifecycle.yearsInService)})
            </span>
          )}
        </dd>

        <dt className="text-slate-500 dark:text-slate-400">EOL (生産終了)</dt>
        <dd className="font-mono text-slate-800 dark:text-slate-200">
          {fmtDate(lifecycle.eolDate)}
        </dd>

        <dt className="text-slate-500 dark:text-slate-400">EOS (サポート終了)</dt>
        <dd className="font-mono text-slate-800 dark:text-slate-200">
          {fmtDate(lifecycle.eosDate)}
          {lifecycle.monthsUntilEos != null && (
            <span className={
              'ml-2 ' + (lifecycle.monthsUntilEos < 12
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-400')
            }>
              ({fmtMonthsUntilEos(lang, lifecycle.monthsUntilEos)})
            </span>
          )}
        </dd>

        <dt className="text-slate-500 dark:text-slate-400">置換期限</dt>
        <dd className="font-mono font-bold text-slate-900 dark:text-slate-100">
          {fmtDate(lifecycle.replaceBy)}
        </dd>
      </dl>

      {/* 進捗バー: 導入から置換期限までの経過率 */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[10px] text-slate-400">
          <span>↑導入</span>
          <span>↑置換期限</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        >
          <div
            className={progress.barClass}
            style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
          />
        </div>
        <div className="mt-1 text-center text-[10px] text-slate-500">
          {progress.percent}%
        </div>
      </div>
    </div>
  )
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function fmtYears(lang: string, n: number): string {
  if (lang === 'en') return `${n}y in service`
  if (lang === 'zh') return `已运行 ${n} 年`
  if (lang === 'ko') return `${n}년 사용`
  return `${n}年運用`
}

function fmtMonthsUntilEos(lang: string, n: number): string {
  if (n < 0) {
    if (lang === 'en') return `EOS exceeded by ${Math.abs(n)}mo`
    if (lang === 'zh') return `EOS 已过 ${Math.abs(n)} 个月`
    if (lang === 'ko') return `EOS ${Math.abs(n)}개월 초과`
    return `EOS 超過 ${Math.abs(n)}ヶ月`
  }
  if (lang === 'en') return `${n}mo until EOS`
  if (lang === 'zh') return `距 EOS 还有 ${n} 个月`
  if (lang === 'ko') return `EOS까지 ${n}개월`
  return `EOS まで ${n}ヶ月`
}

function computeProgress(lc: StoreNvrLifecycle): { percent: number; barClass: string } {
  if (!lc.installedAt || !lc.replaceBy) {
    return { percent: 0, barClass: 'h-full bg-slate-300 dark:bg-slate-600' }
  }
  const installed = new Date(lc.installedAt).getTime()
  const replaceBy = new Date(lc.replaceBy).getTime()
  const now       = Date.now()
  if (replaceBy <= installed) return { percent: 100, barClass: 'h-full bg-red-600' }

  const percent = Math.round(((now - installed) / (replaceBy - installed)) * 100)
  let barClass = 'h-full transition-all '
  if (percent < 50)       barClass += 'bg-emerald-500'
  else if (percent < 75)  barClass += 'bg-yellow-500'
  else if (percent < 100) barClass += 'bg-orange-500'
  else                    barClass += 'bg-red-600'
  return { percent: Math.max(0, percent), barClass }
}

const STATUS_LABEL: Record<NvrLifecycleStatus, { ja: string; en: string }> = {
  nvr_lifecycle_unknown:         { ja: '不明',            en: 'Unknown' },
  nvr_lifecycle_ok:              { ja: 'サポート期間中',  en: 'Supported' },
  nvr_lifecycle_warning:         { ja: '24ヶ月以内 EOS',  en: 'EOS within 24mo' },
  nvr_lifecycle_replace_planned: { ja: '置換計画推奨',    en: 'Replace planned' },
  nvr_lifecycle_urgent:          { ja: '緊急: 置換必須',  en: 'Urgent replace' },
  nvr_lifecycle_eos:             { ja: 'EOS 超過',        en: 'Past EOS' },
  nvr_lifecycle_overage:         { ja: '7年運用超過',     en: '7yr rule exceeded' },
}

const STATUS_STYLE: Record<NvrLifecycleStatus, string> = {
  nvr_lifecycle_unknown:         'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  nvr_lifecycle_ok:              'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  nvr_lifecycle_warning:         'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  nvr_lifecycle_replace_planned: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  nvr_lifecycle_urgent:          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  nvr_lifecycle_eos:             'bg-red-600 text-white',
  nvr_lifecycle_overage:         'bg-red-600 text-white',
}
