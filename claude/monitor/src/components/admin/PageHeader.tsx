import Link from 'next/link'

export function PageHeader({
  title,
  crumb,
  actions,
}: {
  title: string
  crumb?: { href: string; label: string }[]
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-gedline dark:bg-gedbg2">
      <div>
        {crumb && crumb.length > 0 && (
          <div className="text-[11px] text-slate-500 dark:text-gedink3">
            {crumb.map((c, i) => (
              <span key={c.href}>
                {i > 0 && <span className="mx-1.5">/</span>}
                <Link href={c.href} className="hover:text-blue-600 dark:hover:text-gedaccent">{c.label}</Link>
              </span>
            ))}
          </div>
        )}
        <h1 className="text-base font-bold text-slate-900 dark:text-gedink">{title}</h1>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Btn({
  children,
  variant = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const cls =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : variant === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700'
        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
  return (
    <button
      {...props}
      className={`rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function LinkBtn({
  href,
  variant = 'default',
  children,
}: {
  href: string
  variant?: 'default' | 'primary'
  children: React.ReactNode
}) {
  const cls =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-gedaccent dark:text-gedbg dark:hover:opacity-90'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-gedline dark:bg-gedbg3 dark:text-gedink dark:hover:bg-gedbg2'
  return (
    <Link
      href={href}
      className={`rounded px-3 py-1.5 text-xs font-medium ${cls}`}
    >
      {children}
    </Link>
  )
}
