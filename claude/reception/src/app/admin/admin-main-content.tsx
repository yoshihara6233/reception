'use client'

import { usePathname } from 'next/navigation'

export function AdminMainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLogin = pathname === '/admin/login'

  return (
    <main className={isLogin ? '' : 'pt-[96px] px-8 pb-8'}>
      {children}
    </main>
  )
}
