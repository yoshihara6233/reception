'use client'

/**
 * AdminShell の本体レイアウト（クライアント）。左メニューの折りたたみを担う。
 * 折りたたみ状態は cookie(nav_collapsed) に保存し、サーバ側で初期値を渡すことで
 * リロード時のちらつきを防ぐ。折りたたみ時は左を細いレール（展開ボタンのみ）にして
 * 右のコンテンツを広げる。
 */
import { useState } from 'react'
import Link from 'next/link'
import type { NavItem } from './AdminShell'

export function AdminShellClient({
  nav, title, pathname, initialCollapsed, children,
}: {
  nav: NavItem[]
  title: string
  pathname: string
  initialCollapsed: boolean
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      document.cookie = `nav_collapsed=${next ? '1' : '0'}; path=/; max-age=15552000; samesite=lax`
      return next
    })
  }

  return (
    <div className={`grid flex-1 overflow-hidden ${collapsed ? 'grid-cols-[40px_1fr]' : 'grid-cols-[220px_1fr]'}`}>
      {collapsed ? (
        // 細いレール: 展開ボタンのみ
        <aside className="flex flex-col items-center border-r border-slate-200 bg-slate-50 pt-2 dark:border-gedline dark:bg-gedbg2">
          <button
            onClick={toggle}
            aria-label="メニューを開く"
            title="メニューを開く"
            className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:text-gedink2 dark:hover:bg-gedbg3"
          >
            »
          </button>
        </aside>
      ) : (
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 dark:border-gedline dark:bg-gedbg2">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 dark:border-gedline dark:bg-gedbg2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{title}</span>
            <button
              onClick={toggle}
              aria-label="メニューを閉じる"
              title="メニューを閉じる"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:text-gedink3 dark:hover:bg-gedbg3"
            >
              «
            </button>
          </div>
          <nav className="p-2 text-xs">
            {nav.map((e) => {
              // 区切り見出し（②運営管理 等）: リンクではなくラベルのみ描画。
              if (e.heading) {
                return (
                  <div key={e.href} className="mt-3 border-t border-slate-200 px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-gedline dark:text-gedink3">
                    {e.label}
                  </div>
                )
              }
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
      )}
      <main className="overflow-auto bg-slate-100 dark:bg-gedbg">{children}</main>
    </div>
  )
}
