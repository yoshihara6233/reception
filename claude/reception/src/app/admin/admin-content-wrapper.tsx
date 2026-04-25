'use client'

import { usePathname } from 'next/navigation'

// サブナビが出るパス（管理/設定/マニュアル）
const SUB_NAV_PATHS = ['/admin/stores', '/admin/persons', '/admin/pre-registrations', '/admin/settings', '/admin/users', '/admin/logs', '/admin/manual']

export function AdminContentWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hasSubNav = SUB_NAV_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  return (
    <main style={{ paddingTop: hasSubNav ? 92 : 52, paddingLeft: 32, paddingRight: 32, paddingBottom: 32, boxSizing: 'border-box' }}>
      {children}
    </main>
  )
}
