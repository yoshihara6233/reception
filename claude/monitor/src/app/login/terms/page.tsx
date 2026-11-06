'use client'

/**
 * /login/terms — 利用約款への同意 (2026-11-06・G-9・約款の本体 第 4 条 2 項・3 項)。
 *
 * テナント管理者が初めてログインしたときと、約款の版が上がったあとに、middleware がここへ送る
 * (lib/auth/terms.ts)。約款の掲載先を見せ、明示の「同意する」を押してもらう (クリックラップ)。
 * 押すとサーバが日時・版・利用者・接続元を記録する。同意しないときはサインアウトだけを選べる。
 * 戻り先 (next) はほかのログインの画面と同じく safeNext で絞る。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authFetch } from '@/lib/auth/post-json'
import { safeNext } from '@/lib/auth/safe-next'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'

export default function TermsConsentPage() {
  const router = useRouter()
  const [version, setVersion] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const next = () => safeNext(new URL(window.location.href).searchParams.get('next'))

  useEffect(() => {
    authFetch('/api/auth/terms', 'GET').then(({ status, data }) => {
      if (status === 401) { router.replace('/login'); return }
      // 求められていない人 (同意済み・管理者でない・施行の前) は元の画面へ
      if (data.required !== true) { router.replace(next()); return }
      setVersion(typeof data.version === 'string' ? data.version : null)
      setUrl(typeof data.url === 'string' ? data.url : '')
    })
  }, [router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed || !version) return
    setError(null)
    setBusy(true)
    const { status, data } = await authFetch('/api/auth/terms', 'POST', { version })
    setBusy(false)
    if (status !== 200) {
      setError(typeof data.error === 'string' ? data.error : '同意を記録できませんでした。時間をおいてお試しください。')
      return
    }
    // 新しいトークンで読み直す (middleware の判定を作り直させる)
    window.location.replace(next())
  }

  async function onSignOut() {
    await authFetch('/api/auth/logout')
    window.location.replace('/login')
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <form onSubmit={onSubmit} className="w-full max-w-md space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-sm font-bold text-slate-900">利用約款への同意</h1>

        {version === null && <p className="text-xs text-slate-500">確かめています…</p>}

        {version !== null && (
          <>
            <p className="text-xs leading-relaxed text-slate-600">
              テナント管理者は、利用約款を確かめて同意してください。初めてログインしたときと、約款が新しい版になったときに、管理者ごとにお願いしています。同意するまで、ほかの画面は開けません。
            </p>
            <p className="text-xs">
              <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">利用約款を開く</a>
              <span className="ml-2 break-all font-mono text-slate-500">{url}</span>
            </p>
            <label className="flex items-start gap-2 text-sm leading-relaxed text-slate-800">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 flex-shrink-0" />
              <span>利用約款（版 <span className="font-mono tabular-nums">{version}</span>）を確かめ、契約者（お客様）の管理者として、または契約者から委ねられて同意します。</span>
            </label>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <button type="submit" disabled={busy || !agreed}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? '記録しています…' : '同意して始める'}
            </button>
          </>
        )}

        <p className="text-center">
          <button type="button" onClick={onSignOut} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
            同意せずにサインアウト
          </button>
        </p>
      </form>
    </main>
  )
}
