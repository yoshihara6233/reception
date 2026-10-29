'use client'

/**
 * /login/password — 管理者が決めた仮のパスワードを、本人のパスワードに変える (2026-10-30・ASVS 6.4.1)。
 *
 * 仮のパスワードで入った人は、変えるまで middleware がここへ送る (lib/auth/initial-password.ts)。
 * 仮のパスワードの期限が過ぎていれば、その案内とサインアウトだけを出す。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authFetch } from '@/lib/auth/post-json'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'

type State = 'none' | 'pending' | 'expired'

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function InitialPasswordPage() {
  const router = useRouter()
  const [state, setState] = useState<State | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authFetch('/api/auth/initial-password', 'GET').then(({ status, data }) => {
      if (status === 401) { router.replace('/login'); return }
      const s = data.state as State | undefined
      // 変える必要の無い人 (変え済み) は元の画面へ
      if (s === 'none') { router.replace('/'); return }
      setState(s ?? 'pending')
      setExpiresAt(typeof data.expiresAt === 'string' ? data.expiresAt : null)
    })
  }, [router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('パスワードは8文字以上で入力してください。'); return }
    if (password !== confirm) { setError('確認のパスワードが一致しません。'); return }
    setBusy(true)
    const { status, data } = await authFetch('/api/auth/initial-password', 'POST', { password })
    setBusy(false)
    if (status !== 200) {
      setError(typeof data.error === 'string' ? data.error : 'パスワードを変更できませんでした。時間をおいてお試しください。')
      return
    }
    // 新しいトークンで読み直す (middleware の判定を作り直させる)
    window.location.replace('/')
  }

  async function onSignOut() {
    await authFetch('/api/auth/logout')
    window.location.replace('/login')
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-sm font-bold text-slate-900">パスワードの変更</h1>

        {state === null && <p className="text-xs text-slate-500">確かめています…</p>}

        {state === 'expired' && (
          <p className="text-sm leading-relaxed text-slate-700">
            仮のパスワードの有効期限が過ぎています。管理者にパスワードの再発行を依頼してください。
          </p>
        )}

        {state === 'pending' && (
          <>
            <p className="text-xs leading-relaxed text-slate-600">
              管理者が設定した仮のパスワードでログインしています。使い始める前に、ご自身だけが知るパスワードに変更してください。
              {expiresAt && <> 仮のパスワードは <span className="font-mono tabular-nums">{fmtJst(expiresAt)}</span> まで使えます。</>}
            </p>
            <div className="space-y-1">
              <label htmlFor="new-password" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">新しいパスワード（8 文字以上）</label>
              <input id="new-password" type="password" autoFocus autoComplete="new-password" minLength={8} value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm-password" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">新しいパスワード（確認）</label>
              <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirm}
                     onChange={(e) => setConfirm(e.target.value)}
                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <button type="submit" disabled={busy || password.length < 8 || confirm.length < 8}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? '変更中…' : '変更して始める'}
            </button>
          </>
        )}

        <p className="text-center">
          <button type="button" onClick={onSignOut} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
            サインアウト
          </button>
        </p>
      </form>
    </main>
  )
}
