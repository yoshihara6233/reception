'use client'

/**
 * /suspended — テナントが停止 (suspended) しているときの案内 (2026-10-29・自主診断 ASVS 7.4.2)。
 *
 * 停止したテナントの利用者は、middleware が画面と API を止めてここへ送る。
 * 理由を出し、サインアウトしてログイン画面へ戻れるようにする。
 */
import { useRouter } from 'next/navigation'
import { authFetch } from '@/lib/auth/post-json'
import { MonitorMark } from '@/components/MonitorMark'
import { PRODUCT_NAME } from '@/lib/brand'

export default function SuspendedPage() {
  const router = useRouter()
  async function onSignOut() {
    await authFetch('/api/auth/logout')
    router.push('/login')
    router.refresh()
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-sm font-bold text-slate-900">ご利用を停止しています</h1>
        <p className="text-sm leading-relaxed text-slate-700">
          このアカウントの会社 (テナント) は、ご利用を停止しています。画面と拠点へのサインインは使えません。
          再開については、販売店または運営の窓口へお問い合わせください。
        </p>
        <button type="button" onClick={onSignOut}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          サインアウト
        </button>
      </div>
    </main>
  )
}
