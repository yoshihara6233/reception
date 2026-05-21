'use client'

import { usePathname } from 'next/navigation'

// サブナビが出るパス（管理/設定/マニュアル）
const SUB_NAV_PATHS = ['/admin/stores', '/admin/persons', '/admin/pre-registrations', '/admin/settings', '/admin/users', '/admin/logs', '/admin/manual']

// ナビ非表示のスタンドアローンページ（ログイン系）
const NO_NAV_PATHS = ['/admin/login', '/admin/forgot-password', '/admin/reset-password']

export function AdminContentWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isNoNav = NO_NAV_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const hasSubNav = !isNoNav && SUB_NAV_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isNoNav) {
    return <>{children}</>
  }
  return (
    <main style={{ paddingTop: hasSubNav ? 92 : 52, paddingLeft: 32, paddingRight: 32, paddingBottom: 32, boxSizing: 'border-box' }}>
      {children}
    </main>
  )
}
