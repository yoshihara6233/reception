/**
 * /admin/reports/usage — 月次利用状況レポート（R5）
 *
 * usage_daily を集計する読取RPC（usage_summary/weekday/trend）を叩き、契約 vs 登録・
 * テナント全体/店舗別の利用量・曜日別・月次推移を表示する。スコープは resolveAdminContext:
 * super_admin=操作中テナント / tenant_admin=自テナント / store_manager=担当店舗。
 *
 * 段と列はテナントが契約しているオプション (巡回・発報・手荷物検査) で出し分ける
 * (2026-09-30・発注者の判断)。G・VMS だけのテナントには、代わりに G・VMS の段
 * (登録カメラ台数・同時視聴の上限の目安と設定値・ライブ視聴) を出す。
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { jstDateStr } from '@/lib/baggage/unmatch'
import { missingCriticalEnv } from '@/lib/ops/env-check'
import { resolveTenantFeatures } from '@/lib/tenant/features'
import {
  monthBounds, trendBounds, confirmRatePct, prevMonth, viewerLimitFor, CAMERAS_PER_VIEWER,
  type UsageMetrics, type UsageShow,
} from '@/lib/reports/usage'
import { UsageStoreTable } from './UsageStoreTable'
import { MonthlyFinalize } from './MonthlyFinalize'
import { WeekdayChart } from './WeekdayChart'

interface StoreRow extends UsageMetrics { store_id: string; store_name: string }
interface WeekdayRow { dow: number; patrol_count: number; alarm_count: number; inspection_count: number; baggage_exit_count: number; baggage_confirmed_count: number; face_auth_attempts: number; video_live_count: number; footage_access_count: number }
interface TrendRow extends Omit<WeekdayRow, 'dow'> { month: string }

const TREND_MONTHS = 6

function num(v: unknown): number { return typeof v === 'number' ? v : Number(v ?? 0) }

export default async function UsageReportPage({
  searchParams,
}: { searchParams: Promise<{ month?: string }> }) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const ctx = await resolveAdminContext(supa)
  if (!ctx.role || !['super_admin', 'tenant_admin', 'store_manager', 'viewer', 'baggage_manager'].includes(ctx.role)) {
    redirect('/login')
  }

  // 対象月（既定=当月・JST）。
  const { month: monthParam } = await searchParams
  const todayJst = jstDateStr(new Date())
  const [curY, curM] = [Number(todayJst.slice(0, 4)), Number(todayJst.slice(5, 7))]
  let year = curY, month = curM
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    year = Number(monthParam.slice(0, 4)); month = Number(monthParam.slice(5, 7))
  }
  const { from, to } = monthBounds(year, month)
  const trend = trendBounds(year, month, TREND_MONTHS)

  const scopeTenant = ctx.tenantId
  const scopeStores = ctx.storeIds

  // 旧ダッシュボードから集約: 構成・稼働カウント（RLSでスコープ）＋ env 警告(運営のみ)。
  // 店舗数は下の「登録数（／契約数）」と重複するためここには出さない。
  const [edges, recorders, cameras, online, offline] = await Promise.all([
    supa.from('edge_devices').select('*', { count: 'exact', head: true }),
    supa.from('recorders').select('*', { count: 'exact', head: true }),
    // G・VMS で削除したカメラ (removed_at あり) は数えない
    supa.from('recorder_cameras').select('*', { count: 'exact', head: true }).is('removed_at', null),
    supa.from('edge_devices').select('*', { count: 'exact', head: true }).neq('status', 'offline'),
    supa.from('edge_devices').select('*', { count: 'exact', head: true }).eq('status', 'offline'),
  ])
  // エッジサーバ (/admin/edges) は運営だけが開ける。パートナーは拠点稼働へ送る
  // (押すと「権限がありません」になっていた・2026-09-30)。
  const edgeHref = (q = '') => (ctx.isSuper ? `/admin/edges${q}` : '/admin/fleet')
  const infraStats = [
    { label: 'エッジ',     val: edges.count     ?? 0, href: edgeHref() },
    { label: 'レコーダ',   val: recorders.count ?? 0, href: edgeHref() },
    { label: 'カメラ',     val: cameras.count   ?? 0, href: edgeHref() },
    { label: 'オンライン', val: online.count    ?? 0, href: edgeHref('?status=online') },
    { label: 'オフライン', val: offline.count   ?? 0, href: edgeHref('?status=offline'), warn: true },
  ]
  const missingEnv = ctx.isSuper ? missingCriticalEnv() : []

  // env 警告（運営のみ）は上部アラートとして残す。
  const envWarning = missingEnv.length > 0 && (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">環境変数の設定漏れ（Vercel → Settings → Environment Variables）</div>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {missingEnv.map((i) => (
          <li key={i.key} className="flex items-baseline gap-2">
            <span className={'rounded px-1.5 py-px text-[10px] font-bold ' + (i.required ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{i.required ? '必須' : '推奨'}</span>
            <code className="font-mono font-semibold">{i.key}</code>
            <span className="text-slate-500">— {i.purpose}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  // 構成・稼働カードは最下部（PDF の下）に置く。
  const infraSection = (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">構成・稼働（現在）</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {infraStats.map((s) => (
          <a key={s.label} href={s.href} className="block rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-blue-400">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{s.label}</div>
            <div className={'text-2xl font-bold tabular-nums ' + (s.warn ? 'text-red-600' : 'text-slate-900')}>{s.val.toLocaleString()}</div>
          </a>
        ))}
      </div>
    </section>
  )

  // super_admin は操作中テナント未選択だと全テナント横断になり重い＝選択を促す
  // （構成・稼働と env 警告は上に出す）。
  if (ctx.role === 'super_admin' && !scopeTenant) {
    return (
      <AdminShell pathname="/admin/reports/usage" section="admin">
        <PageHeader title="利用状況レポート" crumb={[{ href: '/admin', label: 'マスタ' }, { href: '/admin/reports/usage', label: '利用状況レポート' }]} />
        <div className="space-y-5 px-5 py-4">
          {envWarning}
          <div className="max-w-2xl space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p>テナントを選択すると、そのテナントの利用状況（G・VMS の登録カメラと同時視聴の上限・ライブ視聴と、契約しているオプションの巡回/発報/検査・曜日別・月次推移）を表示します。</p>
            <p><Link href="/admin/tenants" className="text-blue-600 underline">運営管理 → テナント</Link> から「このテナントを操作」を押してください。</p>
          </div>
          {infraSection}
        </div>
      </AdminShell>
    )
  }

  const svc = createSupabaseService()
  // 契約しているオプション。super_admin は操作中テナントのもの (未確定・取得失敗は全部出す)
  const show: UsageShow = await resolveTenantFeatures()
  const rpcArgs = { p_tenant: scopeTenant, p_store_ids: scopeStores }
  const [{ data: sumData }, { data: wdData }, { data: trData }] = await Promise.all([
    svc.rpc('usage_summary', { p_from: from, p_to: to, ...rpcArgs }),
    svc.rpc('usage_weekday', { p_from: from, p_to: to, ...rpcArgs }),
    svc.rpc('usage_trend',   { p_from: trend.from, p_to: trend.to, ...rpcArgs }),
  ])
  const stores = ((sumData ?? []) as StoreRow[]).map((r) => ({
    ...r,
    patrol_count: num(r.patrol_count), alarm_count: num(r.alarm_count), inspection_count: num(r.inspection_count),
    baggage_exit_count: num(r.baggage_exit_count), baggage_confirmed_count: num(r.baggage_confirmed_count),
    face_auth_matched: num(r.face_auth_matched), face_auth_unmatched: num(r.face_auth_unmatched), face_auth_attempts: num(r.face_auth_attempts),
    video_live_count: num(r.video_live_count), footage_access_count: num(r.footage_access_count),
  }))
  const weekday = ((wdData ?? []) as WeekdayRow[])
  const trendRows = ((trData ?? []) as TrendRow[])

  // テナント全体の合計。
  const T = stores.reduce((a, s) => ({
    patrol: a.patrol + s.patrol_count, alarm: a.alarm + s.alarm_count, inspection: a.inspection + s.inspection_count,
    exit: a.exit + s.baggage_exit_count, confirmed: a.confirmed + s.baggage_confirmed_count,
    matched: a.matched + s.face_auth_matched, unmatched: a.unmatched + s.face_auth_unmatched, attempts: a.attempts + s.face_auth_attempts,
    live: a.live + s.video_live_count, footage: a.footage + s.footage_access_count,
  }), { patrol: 0, alarm: 0, inspection: 0, exit: 0, confirmed: 0, matched: 0, unmatched: 0, attempts: 0, live: 0, footage: 0 })
  const confirmRate = confirmRatePct(T.confirmed, T.exit)

  // 契約 vs 登録（テナントが確定しているとき）。
  let contract: { max_stores: number | null; max_patrol: number | null; max_alarm: number | null; max_baggage: number | null } | null = null
  let reg: { stores: number; patrol: number; alarm: number; baggage: number } | null = null
  if (scopeTenant) {
    const { data: tn } = await svc.from('tenants').select('max_stores, max_patrol, max_alarm, max_baggage').eq('id', scopeTenant).maybeSingle()
    contract = tn ? { max_stores: tn.max_stores as number | null, max_patrol: tn.max_patrol as number | null, max_alarm: tn.max_alarm as number | null, max_baggage: tn.max_baggage as number | null } : null
    const countOn = async (col?: 'opt_patrol' | 'opt_alarm' | 'opt_baggage') => {
      let q = svc.from('stores').select('id', { count: 'exact', head: true }).eq('tenant_id', scopeTenant)
      if (col) q = q.eq(col, true)
      const { count } = await q
      return count ?? 0
    }
    const [sc, pc, ac, bc] = await Promise.all([countOn(), countOn('opt_patrol'), countOn('opt_alarm'), countOn('opt_baggage')])
    reg = { stores: sc, patrol: pc, alarm: ac, baggage: bc }
  }

  // G・VMS の段: 登録カメラ台数と、同時視聴の上限 (目安と設定値)。テナント確定時のみ。
  // 上限の契約はカメラ 50 台ごとに 1 名で、運営が 運営管理 → 視聴上限 に入れる (自動では決めない)。
  // 埋め込み結合 (stores!inner 等) は外部キーの張り方で 400 になった前例があるので、段を踏んで数える。
  let gvms: { cameras: number; target: number; configured: number; configuredIsDefault: boolean } | null = null
  if (scopeTenant) {
    const { data: st } = await svc.from('stores').select('id').eq('tenant_id', scopeTenant).limit(10_000)
    const storeIds = (st ?? []).map((r) => r.id as string)
    let camCount = 0
    if (storeIds.length > 0) {
      const { data: eds } = await svc.from('edge_devices').select('id').in('store_id', storeIds).limit(10_000)
      const edgeIds = (eds ?? []).map((r) => r.id as string)
      if (edgeIds.length > 0) {
        const { data: recs } = await svc.from('recorders').select('id').in('edge_id', edgeIds).limit(10_000)
        const recIds = (recs ?? []).map((r) => r.id as string)
        if (recIds.length > 0) {
          const { count } = await svc.from('recorder_cameras').select('id', { count: 'exact', head: true }).in('recorder_id', recIds).is('removed_at', null)
          camCount = count ?? 0
        }
      }
    }
    const { data: lim } = await svc.from('session_limits').select('max_concurrent').eq('tenant_id', scopeTenant).maybeSingle()
    gvms = {
      cameras: camCount,
      target: viewerLimitFor(camCount),
      configured: (lim?.max_concurrent as number | undefined) ?? 5, // 行が無いときは既定 5 (session_limits の DEFAULT)
      configuredIsDefault: lim == null,
    }
  }

  // 月次確定レポート（C）一覧（テナント確定時のみ）。
  let finalized: { id: string; ym: string; generated_at: string; pdf_url: string | null }[] = []
  if (scopeTenant) {
    const { data: fr } = await svc.from('monthly_reports')
      .select('id, ym, generated_at, pdf_url').eq('tenant_id', scopeTenant)
      .order('ym', { ascending: false }).limit(12)
    finalized = (fr ?? []) as typeof finalized
  }
  const canFinalize = ctx.role === 'super_admin' || ctx.role === 'tenant_admin'

  const monthLabel = `${year}年${month}月`
  const prev = prevMonth(year, month)
  const next = month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  const isCurrentOrFuture = year > curY || (year === curY && month >= curM)
  const mstr = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

  return (
    <AdminShell pathname="/admin/reports/usage" section="admin">
      <PageHeader
        title="利用状況レポート"
        crumb={[{ href: '/admin', label: 'マスタ' }, { href: '/admin/reports/usage', label: '利用状況レポート' }]}
      />
      <div className="space-y-5 px-5 py-4">
        {envWarning}

        {/* 月ナビ */}
        <div className="flex items-center gap-3 text-sm">
          <Link href={`?month=${mstr(prev.year, prev.month)}`} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50">← 前月</Link>
          <span className="min-w-[7rem] text-center font-bold tabular-nums">{monthLabel}</span>
          {!isCurrentOrFuture
            ? <Link href={`?month=${mstr(next.year, next.month)}`} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50">翌月 →</Link>
            : <span className="rounded border border-slate-100 px-2 py-1 text-slate-300">翌月 →</span>}
          {ctx.tenantName && <span className="ml-2 text-xs text-slate-500">テナント: <b>{ctx.tenantName}</b></span>}
        </div>

        {/* 契約 vs 登録 */}
        {contract && reg && (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">登録数（／契約数）</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <RegCard label="拠点数" used={reg.stores} limit={contract.max_stores} />
              {show.patrol && <RegCard label="巡回 ON拠点" used={reg.patrol} limit={contract.max_patrol} />}
              {show.alarm && <RegCard label="発報 ON拠点" used={reg.alarm} limit={contract.max_alarm} />}
              {show.baggage && <RegCard label="検査 ON拠点" used={reg.baggage} limit={contract.max_baggage} />}
            </div>
          </section>
        )}

        {/* G・VMS (遠隔視聴) */}
        {gvms && (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">G・VMS（遠隔視聴）</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="登録カメラ" value={gvms.cameras} sub="拠点の G・VMS から同期した台数" />
              <StatCard label="同時視聴の上限（目安）" value={`${gvms.target} 名`} sub={`カメラ ${CAMERAS_PER_VIEWER} 台ごとに 1 名`} />
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">同時視聴の上限（設定値）</div>
                <div className="text-2xl font-bold tabular-nums">{gvms.configured} 名</div>
                <div className="text-[11px] text-slate-500">{gvms.configuredIsDefault ? '未設定のため既定値' : '運営管理 → 視聴上限'}</div>
                {gvms.configured !== gvms.target && (
                  <div className="mt-1 text-[11px] font-bold text-amber-700">
                    目安と違います
                    {ctx.isSuper && <> — <Link href="/admin/limits" className="underline">視聴上限で直す</Link></>}
                  </div>
                )}
              </div>
              <StatCard label={`ライブ視聴（${monthLabel}）`} value={T.live} sub={`映像アクセス ${T.footage.toLocaleString()} 件`} />
            </div>
          </section>
        )}

        {/* テナント全体の利用量 */}
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">利用量（{monthLabel}・{scopeStores ? '担当拠点' : 'テナント全体'}）</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {show.patrol && <StatCard label="巡回数" value={T.patrol} />}
            {show.alarm && <StatCard label="発報数" value={T.alarm} />}
            {show.baggage && <StatCard label="手荷物検査数" value={T.inspection} />}
            {show.baggage && <StatCard label="手荷物検査の映像確認率" value={confirmRate == null ? '—' : `${confirmRate}%`} sub={`${T.confirmed.toLocaleString()} / ${T.exit.toLocaleString()} 退出検査`} />}
            {show.baggage && <StatCard label="顔認証" value={T.attempts} sub={`一致 ${T.matched.toLocaleString()} / アンマッチ ${T.unmatched.toLocaleString()}`} />}
            <StatCard label="ライブ視聴" value={T.live} />
            <StatCard label="映像アクセス" value={T.footage} />
          </div>
        </section>

        {/* 店舗別 + CSV */}
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">拠点別</h2>
          <UsageStoreTable rows={stores} monthLabel={monthLabel} show={show} />
        </section>

        {/* 曜日別 (巡回・発報・検査の件数。どれも契約していなければ出さない) */}
        {(show.patrol || show.alarm || show.baggage) && (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">曜日別（{monthLabel}・合計）</h2>
            <WeekdayChart rows={weekday} show={show} />
          </section>
        )}

        {/* 月次推移 */}
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">月次推移（直近{TREND_MONTHS}ヶ月）</h2>
          <TrendTable rows={trendRows} show={show} />
        </section>

        {/* 月次確定レポート（PDF） */}
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">月次確定レポート（PDF）</h2>
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            {canFinalize && scopeTenant && <MonthlyFinalize ym={mstr(year, month)} monthLabel={monthLabel} />}
            {finalized.length === 0
              ? <p className="text-xs text-slate-400">確定済みのレポートはまだありません。上のボタンで当月を確定できます（毎月の作成日に自動確定＝テナント編集で設定）。</p>
              : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {finalized.map((f) => (
                    <li key={f.id} className="flex items-center justify-between py-1.5">
                      <span className="tabular-nums">{f.ym} <span className="ml-2 text-[11px] text-slate-400">確定 {new Date(f.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' })}</span></span>
                      {f.pdf_url
                        ? <a href={f.pdf_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">PDF ↓</a>
                        : <span className="text-slate-300">PDFなし</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </section>

        {/* 構成・稼働（現在）＝最下部 */}
        {infraSection}
      </div>
    </AdminShell>
  )
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function RegCard({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const over = limit != null && used > limit
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-bold tabular-nums">
        {used.toLocaleString()} <span className="text-slate-400">/ {limit == null ? '∞' : limit.toLocaleString()}</span>
      </div>
      {over && <div className="text-[11px] font-bold text-amber-600">上限超過</div>}
    </div>
  )
}

function TrendTable({ rows, show }: { rows: { month: string; patrol_count: number; alarm_count: number; inspection_count: number; baggage_confirmed_count: number; baggage_exit_count: number; face_auth_attempts: number; video_live_count?: number | string; footage_access_count?: number | string }[]; show: UsageShow }) {
  if (!rows.length) return <p className="text-xs text-slate-400">データがありません。</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">月</th>
            {show.patrol && <th className="px-3 py-2 text-right">巡回</th>}
            {show.alarm && <th className="px-3 py-2 text-right">発報</th>}
            {show.baggage && <th className="px-3 py-2 text-right">検査</th>}
            {show.baggage && <th className="px-3 py-2 text-right">映像確認率</th>}
            {show.baggage && <th className="px-3 py-2 text-right">顔認証</th>}
            <th className="px-3 py-2 text-right">ライブ視聴</th>
            <th className="px-3 py-2 text-right">映像アクセス</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = confirmRatePct(Number(r.baggage_confirmed_count), Number(r.baggage_exit_count))
            return (
              <tr key={r.month} className="border-t border-slate-100">
                <td className="px-3 py-1.5 tabular-nums">{r.month.slice(0, 7)}</td>
                {show.patrol && <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.patrol_count).toLocaleString()}</td>}
                {show.alarm && <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.alarm_count).toLocaleString()}</td>}
                {show.baggage && <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.inspection_count).toLocaleString()}</td>}
                {show.baggage && <td className="px-3 py-1.5 text-right tabular-nums">{rate == null ? '—' : `${rate}%`}</td>}
                {show.baggage && <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.face_auth_attempts).toLocaleString()}</td>}
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.video_live_count ?? 0).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.footage_access_count ?? 0).toLocaleString()}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
