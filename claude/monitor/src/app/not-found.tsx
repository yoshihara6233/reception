/**
 * 見つからない画面の案内 (2026-11-04・シナリオ試験の所見)。
 *
 * 以前は Next.js の素の英語の 404 (This page could not be found.) が出ていた。
 * notFound() は「無い URL」のほかに、役割で開けない画面 (例: 拠点管理者が /admin/stores/new)
 * からも呼ばれるので、権限の可能性も添えて、案内先はテナントの管理者にする。
 */
import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { MonitorMark } from '@/components/MonitorMark'
import { PRODUCT_NAME } from '@/lib/brand'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ge-paper px-4 text-ge-ink dark:bg-gedbg dark:text-gedink">
      <div className="flex items-center gap-2">
        <MonitorMark className="h-7 w-7 flex-shrink-0" accent="#2C4A7E" />
        <span className="text-[16px] font-bold">{PRODUCT_NAME}</span>
      </div>
      <FileQuestion className="h-12 w-12 text-ge-ink-3 dark:text-gedink2" strokeWidth={1.5} aria-hidden="true" />
      <h1 className="text-[24px] font-bold">ページが見つかりません</h1>
      <p className="max-w-md text-center text-[14px] leading-relaxed text-ge-ink-2 dark:text-gedink2">
        URL が正しいかお確かめください。<br />
        この画面を開く権限が無い場合も、この表示になります。必要な場合はテナントの管理者にお問い合わせください。
      </p>
      <Link
        href="/stores"
        className="mt-2 rounded-[4px] bg-ge-accent px-6 py-2.5 text-[14px] font-medium text-white hover:bg-ge-ink-2 dark:bg-gedaccent dark:text-gedbg"
      >
        トップへ戻る
      </Link>
    </main>
  )
}
