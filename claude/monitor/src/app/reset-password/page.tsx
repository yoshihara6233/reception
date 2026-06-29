'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MonitorMark } from '@/components/MonitorMark'

function ResetPasswordInner() {
  const router   = useRouter()
  const supabase = createSupabaseBrowser()

  const [ready, setReady]               = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [done, setDone]                 = useState(false)

  // Verify the one-time recovery token from the emailed link. This establishes
  // a short-lived recovery session WITHOUT touching Supabase's redirect
  // allowlist (the token + email travel as query params).
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const url   = new URL(window.location.href)
      const token = url.searchParams.get('token')
      const email = url.searchParams.get('email')

      if (token && email) {
        const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
        if (cancelled) return
        if (verifyErr) {
          setSessionError('リンクが無効または期限切れです。お手数ですが再度お試しください。')
          return
        }
        setReady(true)
        return
      }

      // Fall back to an existing recovery session (e.g. opened via a hash link).
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) { setReady(true); return }
      setSessionError('リンクが無効または期限切れです。お手数ですが再度お試しください。')
    }
    bootstrap()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('パスワードは8文字以上で入力してください。'); return }
    if (password !== confirm) { setError('パスワードが一致しません。'); return }
    setError(null)
    setBusy(true)
    const { error: upErr } = await supabase.auth.updateUser({ password })
    if (upErr) { setError(upErr.message); setBusy(false); return }
    // Sign out the recovery session so the user logs in fresh with the new password.
    await supabase.auth.signOut()
    setDone(true)
    setBusy(false)
    setTimeout(() => router.push('/login'), 1800)
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>

      <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-2xl">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">Recorder Monitor</span>
        </div>

        {sessionError ? (
          <div className="space-y-4">
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{sessionError}</p>
            <Link href="/forgot-password"
                  className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-800">
              再設定リンクを再送する
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-2 py-4 text-center">
            <p className="text-sm font-semibold text-emerald-600">パスワードを変更しました</p>
            <p className="text-xs text-slate-500">ログイン画面へ移動します…</p>
          </div>
        ) : !ready ? (
          <p className="py-6 text-center text-sm text-slate-400">確認中…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <h1 className="text-base font-bold text-slate-900">パスワード再設定</h1>
              <p className="mt-1 text-xs text-slate-500">新しいパスワードを入力してください。</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">新しいパスワード</label>
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                     autoComplete="new-password" placeholder="8文字以上"
                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">パスワード（確認）</label>
              <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                     autoComplete="new-password" placeholder="もう一度入力"
                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

            <button type="submit" disabled={busy}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? '変更中…' : 'パスワードを変更'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-900" />}>
      <ResetPasswordInner />
    </Suspense>
  )
}
