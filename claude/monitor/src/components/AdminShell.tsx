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
import { AppHeader } from './AppHeader'
import { StatusBar } from './StatusBar'
import { AdminShellClient } from './AdminShellClient'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

export type AdminSection = 'admin' | 'security' | 'bcp' | 'infra'

// F22: factory helpers — return translated nav for a given section. Pages
// can pass `section="infra"` to AdminShell and let it build the nav, or
// call these directly when they need the typed array.
export function getAdminNav(t: Msg): NavItem[] {
  return [
    { href: '/admin',            label: t.adminNav.dashboard, icon: '▣', exact: true },
    { href: '/admin/stores',     label: t.adminNav.stores,    icon: '⛬' },
    { href: '/admin/edges',      label: t.adminNav.edges,     icon: '⌬' },
    // レコーダはエッジ配下（/admin/edges/[id]）で管理。専用ページは未実装のため
    // デッドリンク（/admin/recorders）はナビから除外。
    // F49.J: NVR 機種マスタ (EOL/EOS 管理)
    { href: '/admin/nvr-models', label: 'NVR 機種',           icon: '🛰' },
    { href: '/admin/bcp',        label: 'BCP発動条件',         icon: '🚨' },
    { href: '/admin/baggage',    label: '手荷物検査設定',      icon: '🧳' },
    { href: '/admin/users',      label: t.adminNav.users,     icon: '⚇' },
    { href: '/admin/import',     label: t.adminNav.csvImport, icon: '⇪' },
    { href: '/admin/limits',     label: t.adminNav.limits,    icon: '⏱' },
    { href: '/admin/audit',      label: t.adminNav.audit,     icon: '☰' },
  ]
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
}

// マスタ管理（既定）
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin',            label: 'ダッシュボード', icon: '▣', exact: true },
  { href: '/admin/stores',     label: '店舗',           icon: '⛬' },
  { href: '/admin/edges',      label: 'エッジサーバ',   icon: '⌬' },
  { href: '/admin/bcp',        label: 'BCP発動条件',     icon: '🚨' },
  { href: '/admin/baggage',    label: '手荷物検査設定', icon: '🧳' },
  { href: '/admin/users',      label: 'ユーザ',         icon: '⚇' },
  { href: '/admin/import',     label: 'CSV 一括投入',   icon: '⇪' },
  { href: '/admin/limits',     label: '視聴上限',       icon: '⏱' },
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

  // Resolve nav + title. Priority: section (translated) > explicit nav/title
  // > admin default.
  const t = section ? await getT() : null
  const effectiveNav: NavItem[] =
    nav
      ?? (section === 'admin'    ? getAdminNav(t!)
        : section === 'security' ? getSecurityNav(t!)
        : section === 'bcp'      ? getBcpNav(t!)
        : section === 'infra'    ? getInfraNav(t!)
        : ADMIN_NAV)
  const effectiveTitle: string =
    navTitle
      ?? (section && t
            ? t.navTitle[section]
            : '設定')

  // 左メニュー折りたたみの初期値は cookie から（サーバ確定でちらつき防止）。
  const collapsed = (await cookies()).get('nav_collapsed')?.value === '1'

  return (
    <div className="flex h-screen flex-col">
      <AppHeader userName={userName} />
      <AdminShellClient nav={effectiveNav} title={effectiveTitle} pathname={pathname} initialCollapsed={collapsed}>
        {children}
      </AdminShellClient>
      <StatusBar />
    </div>
  )
}
