/**
 * Admin chrome: same dark header + status bar as AppShell, but the left rail
 * is a section navigator instead of the store tree.
 *
 * The left nav is configurable via the `nav` + `navTitle` props so each section
 * (マスタ管理 / 警備 / BCP …) shows its own menu. Defaults to the admin master nav.
 */
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveTenantFeatures } from '@/lib/tenant/features'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { resolveFeedbackEntry } from '@/lib/feedback/entry'
import { ActingTenantBar } from './ActingTenantBar'
import { AppHeader } from './AppHeader'
import { StatusBar } from './StatusBar'
import { AdminShellClient } from './AdminShellClient'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

export type AdminSection = 'admin' | 'security' | 'bcp'

// F22: factory helpers — return translated nav for a given section. Pages
// can pass `section="bcp"` to AdminShell and let it build the nav, or
// call these directly when they need the typed array.
// マスタ管理ナビは2プレーンに分離する:
//   ①設定（テナント運用）— tenant_admin と super_admin が「操作中テナント」に対して使う
//   ②運営管理（SaaS運営）— super_admin 専用。tenant_admin にはメニュー自体を出さない
// CSV一括投入は店舗ページ右上に導線があるためメニューから除外（直URLは有効）。
/** 「拠点の G・VMS」でまとめる 3 画面。左メニューの選択判定と、画面上のタブ (GvmsTabs) が同じ表を使う。 */
export const GVMS_PATHS = ['/admin/fleet', '/admin/provisioning', '/admin/licenses'] as const

export function getAdminNav(t: Msg, opts?: { isSuper?: boolean; baggage?: boolean; feedback?: boolean }): NavItem[] {
  const items: NavItem[] = [
    // 利用状況レポートを最上部に。旧ダッシュボードは廃止し中身をここへ集約。
    { href: '/admin/reports/usage', label: '利用状況レポート', icon: '📊', exact: true },
    { href: '/admin/stores',     label: t.adminNav.stores,    icon: '⛬' },
    { href: '/admin/users',      label: t.adminNav.users,     icon: '⚇' },
    // 拠点の G・VMS を遠隔から扱う 3 画面 (拠点稼働・拠点導入・ライセンス) は左メニューでは
    // 1 項目にまとめ、画面の上のタブ (GvmsTabs) で行き来する (2026-09-30・発注者の指示)。
    // クラウド自身の設定 (拠点・ユーザ・BCP・ログ) と並列だと、どれが何のための画面か
    // 分からないため。3 画面のどれを開いていても、この項目が選択状態になる (match)。
    { href: '/admin/fleet', label: '拠点の G・VMS', icon: '⌬', match: GVMS_PATHS },
    // 手荷物検査の「内容設定」（同意文言・STEP等）はテナント側の持ち物＝①。
    // 「使えるか(ON/OFF=課金)」は②のテナント編集フラグで運営が制御する。
    ...(opts?.baggage !== false
      ? [{ href: '/admin/baggage', label: '手荷物検査設定', icon: '🧳' }] : []),
    { href: '/admin/bcp',        label: 'BCP発動条件',         icon: '🚨' },
    { href: '/admin/audit',      label: t.adminNav.audit,     icon: '☰' },
    // 要望（送った要望の一覧・状態・返事）。テナント管理者だけ（基本設計 §3.1）。
    // super_admin は送らないので出さない（運営管理の「要望ボード」で扱う）。
    ...(opts?.feedback ? [{ href: '/settings/feedback', label: '要望', icon: '✎' }] : []),
  ]
  if (opts?.isSuper) {
    items.push(
      { href: '#ops', label: '運営管理', icon: '', heading: true },
      { href: '/admin/tenants',    label: 'テナント',   icon: '🏢' },
      // super_admin はテナントに属さないため、①設定「ユーザ」からは除外して
      // ここで管理する（テナント文脈の一覧に tenant=— が混じるのを避ける）。
      { href: '/admin/ops-users',  label: 'システム管理者', icon: '⚿' },
      { href: '/admin/edges',      label: t.adminNav.edges, icon: '⌬' },
      // レコーダはエッジ配下（/admin/edges/[id]）で管理。専用ページは未実装のため
      // デッドリンク（/admin/recorders）はナビから除外。
      // 保守自動化②: nvmsd リリース台帳と配備状況 (NVMS/docs/OTA_SPEC.md)
      { href: '/admin/nvmsd-releases', label: 'nvmsd リリース', icon: '⬆' },
      { href: '/admin/limits',     label: t.adminNav.limits, icon: '⏱' },
      // F49.J: NVR 機種マスタ (EOL/EOS 管理)。使う場面が少ないので視聴上限の下へ (2026-09-30・発注者の指示)
      { href: '/admin/nvr-models', label: 'NVR 機種',   icon: '🛰' },
      // 運営(super_admin)自身の行動履歴。テナント側/admin/auditには運営の行を出さない
      // （PR#213）ため、運営の説明責任はこのページで担保する。全テナント横断。
      { href: '/admin/ops-audit',  label: '運営アクセスログ', icon: '☰' },
      // 要望の収集 第 1 段（D-2-21）: 現場とテナントの要望を束ねて扱いを決める。
      { href: '/admin/feedback',   label: '要望ボード', icon: '✎' },
      // 死活監視 (/infra) は 2026-09-30 に廃止した (発注者の判断)。G・VMS の拠点の状態は
      // 拠点稼働 (/admin/fleet) で見る。オフラインの通知は cron/edge-health が別に送る。
    )
  }
  return items
}
export function getSecurityNav(t: Msg): NavItem[] {
  return [
    { href: '/security/reports',  label: t.securityNav.reports,  icon: '📋' },
    { href: '/security',          label: t.securityNav.triage,   icon: '🛡', exact: true },
    { href: '/security/settings', label: t.securityNav.settings, icon: '⏱' },
    { href: '/security/glossary', label: t.securityNav.glossary, icon: '?' },
  ]
}
export function getBcpNav(t: Msg): NavItem[] {
  return [
    { href: '/bcp',          label: t.bcpNav.eventsReports, icon: '🚨', exact: true },
    { href: '/bcp/jalerts',  label: t.bcpNav.jalerts,       icon: '📡' },
    { href: '/bcp/test',     label: t.bcpNav.testIssue,     icon: '⚡' },
    { href: '/bcp/glossary', label: t.bcpNav.glossary,      icon: '?' },
  ]
}

export interface NavItem {
  href: string
  label: string
  icon: string
  /** exact match only (section root, e.g. /admin, /security) — won't activate on sub-paths */
  exact?: boolean
  /** これらのパス (とその配下) のどれかを開いているときも選択状態にする (1 項目で複数画面をまとめる用) */
  match?: readonly string[]
  /** true = リンクではなく区切り見出し（②運営管理 の区分け表示に使用） */
  heading?: boolean
}

// マスタ管理（既定・非i18nフォールバック）。ロール不明のため ①設定 のみ
// （②運営管理 は getAdminNav(t, {isSuper:true}) 経由でのみ出す）。
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/reports/usage', label: '利用状況レポート', icon: '📊', exact: true },
  { href: '/admin/stores',     label: '拠点',           icon: '⛬' },
  { href: '/admin/users',      label: 'ユーザ',         icon: '⚇' },
  { href: '/admin/baggage',    label: '手荷物検査設定', icon: '🧳' },
  { href: '/admin/bcp',        label: 'BCP発動条件',     icon: '🚨' },
  { href: '/admin/audit',      label: 'アクセスログ',   icon: '☰' },
]

// 警備
export const SECURITY_NAV: NavItem[] = [
  { href: '/security/reports',  label: '巡回レポート', icon: '📋' },
  { href: '/security',          label: '即時巡回',     icon: '🛡', exact: true },
  { href: '/security/settings', label: '巡回設定',     icon: '⏱' },
]

// BCP
export const BCP_NAV: NavItem[] = [
  { href: '/bcp',      label: 'レポート / イベント', icon: '🚨', exact: true },
  { href: '/bcp/test', label: 'テスト発令',          icon: '⚡' },
]

// 発報（独立縦割り）
export const ALARM_NAV: NavItem[] = [
  { href: '/alarms',          label: '発報タイムライン', icon: '🔔', exact: true },
  { href: '/alarms/settings', label: '発報設定',         icon: '⚙' },
]

export async function AdminShell({
  pathname,
  children,
  section,
  nav,
  navTitle,
}: {
  pathname: string
  children: React.ReactNode
  // F22: `section` is the preferred way — AdminShell builds an i18n-aware
  // nav + title from the user's lang cookie. `nav`/`navTitle` overrides are
  // kept for callers that need a custom menu, but should be passed already-
  // translated when used.
  section?: AdminSection
  nav?: NavItem[]
  navTitle?: string
}) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const userName = user.user_metadata?.name ?? user.email ?? '不明'

  // テナントのオプション機能（巡回/発報/検査）とテナント文脈
  // （tenant_admin=自テナント / super_admin=操作中テナント）。
  const [features, ctx, feedbackEntry] = await Promise.all([
    resolveTenantFeatures(supa),
    resolveAdminContext(supa),
    resolveFeedbackEntry(),
  ])

  // Resolve nav + title. Priority: section (translated) > explicit nav/title
  // > admin default.
  const t = section ? await getT() : null
  let effectiveNav: NavItem[] =
    nav
      ?? (section === 'admin'    ? getAdminNav(t!, { isSuper: ctx.isSuper, baggage: features.baggage, feedback: feedbackEntry })
        : section === 'security' ? getSecurityNav(t!)
        : section === 'bcp'      ? getBcpNav(t!)
        : ADMIN_NAV)
  // 手荷物検査がオプション無効なら「手荷物検査設定」を隠す（nav 明示指定の経路も含めて保険）。
  if (!features.baggage) {
    effectiveNav = effectiveNav.filter((n) => n.href !== '/admin/baggage')
  }
  const effectiveTitle: string =
    navTitle
      ?? (section && t
            ? t.navTitle[section]
            : '設定')

  // 左メニュー折りたたみの初期値は cookie から（サーバ確定でちらつき防止）。
  const collapsed = (await cookies()).get('nav_collapsed')?.value === '1'

  return (
    <div className="flex h-screen flex-col">
      <AppHeader userName={userName} tenantName={ctx.tenantName} isSuper={ctx.isSuper} features={features} feedbackEntry={feedbackEntry} />
      <AdminShellClient nav={effectiveNav} title={effectiveTitle} pathname={pathname} initialCollapsed={collapsed}>
        {/* super_admin のみ: ①設定プレーンがどのテナントに固定されているかを常時明示 */}
        {ctx.isSuper && section === 'admin' && (
          <ActingTenantBar tenantName={ctx.acting ? ctx.tenantName : null} />
        )}
        {children}
      </AdminShellClient>
      <StatusBar />
    </div>
  )
}
