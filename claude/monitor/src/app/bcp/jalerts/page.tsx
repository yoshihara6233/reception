/**
 * /bcp/jalerts — Jアラート受信履歴
 *
 * jalert-poller が JMA フィードから受信した本番 J-Alert を、店舗マッチの有無に関係なく
 * 全件記録した jalert_receipts を新着順に一覧する。テスト発令(/bcp/test)は別経路で
 * このテーブルを通らないため、ここは「実際に受信した J-Alert のみ」になる。
 *
 * 既存 /bcp（発令→店舗の録画ツリー）が「録画した分だけ」を見るのに対し、本ページは
 * 「全国で何を受信したか＝システムが生きている証明」を見るための受信ログ。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'
import JalertList, { type JalertRow } from './JalertList'
import { Radio } from 'lucide-react'

export default async function JalertsPage() {
  const supa = await createSupabaseServer()
  const t    = await getT()

  const { data } = await supa
    .from('jalert_receipts')
    .select('id, alert_type, title, max_intensity, area_codes, alert_issued_at, received_at, matched_store_count, detail_url')
    .order('received_at', { ascending: false })
    .limit(500)

  const rows = (data ?? []) as JalertRow[]
  const matchedTotal = rows.reduce((n, r) => n + (r.matched_store_count > 0 ? 1 : 0), 0)
  const latest = rows[0]?.received_at ?? null

  return (
    <AdminShell pathname="/bcp/jalerts" section="bcp">
      <PageHeader
        title={t.bcpNav.jalerts}
        crumb={[
          { href: '/bcp',         label: t.breadcrumb.bcp },
          { href: '/bcp/jalerts', label: t.bcpNav.jalerts },
        ]}
      />

      <div className="space-y-4 px-5 py-4">
        {/* 説明バナー */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-base"><Radio size={16} strokeWidth={1.5} aria-hidden /></span>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-slate-600">
              気象庁フィードから受信した <b>本番 J-Alert（地震・特別警報）の全件</b>を新着順に表示します。
              店舗の登録エリアに該当しない発令（例：他地方の地震）も<b>受信した事実として記録</b>され、
              「該当店舗」が <b>対象外</b> と表示されます。テスト発令はここには出ません。
            </p>
          </div>
        </div>

        {/* 統計 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">累計受信</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{rows.length.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">録画起動した発令</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{matchedTotal.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">最終受信 (JST)</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {latest
                ? new Date(latest).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '受信なし'}
            </div>
          </div>
        </div>

        <JalertList rows={rows} />
      </div>
    </AdminShell>
  )
}
