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
import { ActingTenantBar } from './ActingTenantBar'
import { AppHeader } from './AppHeader'
import { StatusBar } from './StatusBar'
import { AdminShellClient } from './AdminShellClient'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

export type AdminSection = 'admin' | 'security' | 'bcp' | 'infra'

// F22: factory helpers — return translated nav for a given section. Pages
// can pass `section="infra"` to AdminShell and let it build the nav, or
// call these directly when they need the typed array.
// マスタ管理ナビは2プレーンに分離する:
//   ①設定（テナント運用）— tenant_admin と super_admin が「操作中テナント」に対して使う
//   ②運営管理（SaaS運営）— super_admin 専用。tenant_admin にはメニュー自体を出さない
// CSV一括投入は店舗ページ右上に導線があるためメニューから除外（直URLは有効）。
export function getAdminNav(t: Msg, opts?: { isSuper?: boolean; baggage?: boolean }): NavItem[] {
  const items: NavItem[] = [
    // 利用状況レポートを最上部に。旧ダッシュボードは廃止し中身をここへ集約。
    { href: '/admin/reports/usage', label: '利用状況レポート', icon: '📊', exact: true },
    { href: '/admin/stores',     label: t.adminNav.stores,    icon: '⛬' },
    { href: '/admin/users',      label: t.adminNav.users,     icon: '⚇' },
    // 手荷物検査の「内容設定」（同意文言・STEP等）はテナント側の持ち物＝①。
    // 「使えるか(ON/OFF=課金)」は②のテナント編集フラグで運営が制御する。
    ...(opts?.baggage !== false
      ? [{ href: '/admin/baggage', label: '手荷物検査設定', icon: '🧳' }] : []),
    { href: '/admin/bcp',        label: 'BCP発動条件',         icon: '🚨' },
    { href: '/admin/audit',      label: t.adminNav.audit,     icon: '☰' },
  ]
  if (opts?.isSuper) {
    items.push(
      { href: '#ops', label: '運営管理', icon: '', heading: true },
      { href: '/admin/tenants',    label: 'テナント',   icon: '🏢' },
      { href: '/admin/edges',      label: t.adminNav.edges, icon: '⌬' },
      // レコーダはエッジ配下（/admin/edges/[id]）で管理。専用ページは未実装のため
      // デッドリンク（/admin/recorders）はナビから除外。
      // F49.J: NVR 機種マスタ (EOL/EOS 管理)
      { href: '/admin/nvr-models', label: 'NVR 機種',   icon: '🛰' },
      { href: '/admin/limits',     label: t.adminNav.limits, icon: '⏱' },
      // 運営(super_admin)自身の行動履歴。テナント側/admin/auditには運営の行を出さない
      // （PR#213）ため、運営の説明責任はこのページで担保する。全テナント横断。
      { href: '/admin/ops-audit',  label: '運営アクセスログ', icon: '☰' },
      // 死活監視(/infra)は SaaS 運営者向け＝中央タブから②運営管理へ移設。全テナント横断。
      { href: '/infra',            label: '死活監視',   icon: '🩺' },
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
export function getInfraNav(t: Msg): NavItem[] {
  // メニュー整理（2026-07-12）: 機能しているページのみ表示。以下は除外（残置・直URL有効）:
  //   インシデント …… ダッシュボードの未対応一覧と重複
  //   中央ノード ……… F49.G Tier3 集約モード未稼働
  //   チェック設定 …… monitor_checks への書き込み元が未実装（P2 能動チェック）＝常に空
  //   稼働率レポート … monitor_reports の生成が未実装（P3）＝常に空。実装時に戻す
  return [
    { href: '/infra',           label: t.infraNav.dashboard, icon: '🩺', exact: true },
    // F50.E: SLO ダッシュボード (Phase 3)
    { href: '/infra/slo',       label: 'SLO',                icon: '📈' },
    { href: '/infra/settings',  label: t.infraNav.settings,  icon: '⚙' },
    { href: '/infra/glossary',  label: t.infraNav.glossary,  icon: '?' },
  ]
}

export interface NavItem {
  href: string
  label: string
  icon: string
  /** exact match only (section root, e.g. /admin, /security) — won't activate on sub-paths */
  exact?: boolean
  /** true = リンクではなく区切り見出し（②運営管理 の区分け表示に使用） */
  heading?: boolean
}

// マスタ管理（既定・非i18nフォールバック）。ロール不明のため ①設定 のみ
// （②運営管理 は getAdminNav(t, {isSuper:true}) 経由でのみ出す）。
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/reports/usage', label: '利用状況レポート', icon: '📊', exact: true },
  { href: '/admin/stores',     label: '店舗',           icon: '⛬' },
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

// インフラ管理（機器ヘルス監視）— getInfraNav と同期を保つこと
export const INFRA_NAV: NavItem[] = [
  { href: '/infra',           label: 'ダッシュボード', icon: '🩺', exact: true },
  { href: '/infra/slo',       label: 'SLO',            icon: '📈' },
  { href: '/infra/settings',  label: '監視設定',       icon: '⚙' },
  { href: '/infra/glossary',  label: '用語説明',       icon: '?' },
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
  const [features, ctx] = await Promise.all([
    resolveTenantFeatures(supa),
    resolveAdminContext(supa),
  ])

  // Resolve nav + title. Priority: section (translated) > explicit nav/title
  // > admin default.
  const t = section ? await getT() : null
  let effectiveNav: NavItem[] =
    nav
      ?? (section === 'admin'    ? getAdminNav(t!, { isSuper: ctx.isSuper, baggage: features.baggage })
        : section === 'security' ? getSecurityNav(t!)
        : section === 'bcp'      ? getBcpNav(t!)
        : section === 'infra'    ? getInfraNav(t!)
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
      <AppHeader userName={userName} tenantName={ctx.tenantName} isSuper={ctx.isSuper} features={features} />
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
