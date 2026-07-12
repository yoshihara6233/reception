/**
 * Admin chrome: same dark header + status bar as AppShell, but the left rail
 * is a section navigator instead of the store tree.
 *
 * The left nav is configurable via the `nav` + `navTitle` props so each section
 * (マスタ管理 / 警備 / BCP …) shows its own menu. Defaults to the admin master nav.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppHeader } from './AppHeader'
import { StatusBar } from './StatusBar'
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
  // メニュー整理（2026-07-12）: インシデントはダッシュボードの未対応一覧と重複、
  // 中央ノード(F49.G Tier3)は未稼働のためメニューから除外（ページ自体は残置・直URLは有効）。
  return [
    { href: '/infra',           label: t.infraNav.dashboard, icon: '🩺', exact: true },
    { href: '/infra/checks',    label: t.infraNav.checks,    icon: '⌬' },
    { href: '/infra/reports',   label: t.infraNav.reports,   icon: '☰' },
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
  { href: '/infra/checks',    label: 'チェック設定',   icon: '⌬' },
  { href: '/infra/reports',   label: '稼働率レポート', icon: '☰' },
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

  return (
    <div className="flex h-screen flex-col">
      <AppHeader userName={userName} />
      <div className="grid flex-1 grid-cols-[220px_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 dark:border-gedline dark:bg-gedbg2">
          <div className="border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">
            {effectiveTitle}
          </div>
          <nav className="p-2 text-xs">
            {effectiveNav.map((e) => {
              const active = e.exact
                ? pathname === e.href
                : pathname === e.href || pathname.startsWith(e.href + '/')
              return (
                <Link
                  key={e.href}
                  href={e.href}
                  className={
                    'flex items-center gap-2 rounded px-2.5 py-1.5 ' +
                    (active
                      ? 'bg-blue-100 font-semibold text-blue-800 dark:bg-gedbg3 dark:text-gedink dark:shadow-[inset_2px_0_0_var(--color-gedaccent)]'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gedink2 dark:hover:bg-gedbg3')
                  }
                >
                  <span className="w-4 text-center">{e.icon}</span>
                  {e.label}
                </Link>
              )
            })}
          </nav>
        </aside>
        <main className="overflow-auto bg-slate-100 dark:bg-gedbg">{children}</main>
      </div>
      <StatusBar />
    </div>
  )
}
