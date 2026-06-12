/**
 * /factory — 製造業 OP (Operations)
 *
 * 現在は中身の機能要件を検討中。プレースホルダ画面のみ表示する。
 */
import { AppHeader } from '@/components/AppHeader'

export default function FactoryPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-gedbg">
      <AppHeader />

      <main className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-gedline dark:bg-gedbg2">
          <div className="mb-4 text-5xl" aria-hidden="true">🏭</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-gedink">
            製造業 OP
          </h1>
          <p className="mt-3 text-sm font-medium text-amber-600 dark:text-amber-400">
            検討中
          </p>
          <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-gedink3">
            製造業向けオペレーション機能は現在企画中です。
            <br />
            機能要件が固まり次第、実装を開始します。
          </p>
        </div>
      </main>
    </div>
  )
}
