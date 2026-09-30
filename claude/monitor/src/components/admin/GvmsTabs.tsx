import Link from 'next/link'

/**
 * 「拠点の G・VMS」の 3 画面 (拠点稼働・拠点導入・ライセンス) を行き来するタブ。
 * 左メニューでは 1 項目にまとめたので、画面の側でこの 3 つを見せる (2026-09-30)。
 * PageHeader の直下に置く。current は開いている画面のパス。
 */
export const GVMS_TABS = [
  { href: '/admin/fleet', label: '拠点稼働' },
  { href: '/admin/provisioning', label: '拠点導入' },
  { href: '/admin/licenses', label: 'ライセンス' },
] as const

export function GvmsTabs({ current }: { current: (typeof GVMS_TABS)[number]['href'] }) {
  return (
    <nav aria-label="拠点の G・VMS" className="flex gap-1 border-b border-slate-200 bg-white px-5 dark:border-gedline dark:bg-gedbg2">
      {GVMS_TABS.map((t) => {
        const active = t.href === current
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              '-mb-px border-b-2 px-3 py-2 text-xs ' +
              (active
                ? 'border-blue-600 font-semibold text-blue-700 dark:border-gedaccent dark:text-gedink'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-gedink3 dark:hover:text-gedink')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
