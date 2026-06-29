'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MonitorMark } from '@/components/MonitorMark'

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [sent, setSent]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/reset-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? '送信に失敗しました。')
        return
      }
      // Always show success — the API never reveals whether the address exists.
      setSent(true)
    } catch {
      setError('ネットワークエラーが発生しました。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>

      <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-2xl">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">Recorder Monitor</span>
        </div>

        {sent ? (
          <div className="space-y-4">
            <h1 className="text-base font-bold text-slate-900">メールを送信しました</h1>
            <p className="text-xs leading-relaxed text-slate-600">
              入力されたメールアドレスが登録されている場合、パスワード再設定用のリンクを送信しました。
              メールをご確認ください（迷惑メールフォルダもご確認ください）。リンクの有効期限は1時間です。
            </p>
            <Link href="/login"
                  className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-800">
              ログイン画面に戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <h1 className="text-base font-bold text-slate-900">パスワードをお忘れの方</h1>
              <p className="mt-1 text-xs text-slate-500">登録済みのメールアドレスを入力してください。再設定用リンクをお送りします。</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">メールアドレス</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                     autoComplete="email"
                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

            <button type="submit" disabled={busy}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? '送信中…' : '再設定リンクを送信'}
            </button>

            <Link href="/login" className="block text-center text-xs text-slate-500 hover:text-slate-700">
              ログイン画面に戻る
            </Link>
          </form>
        )}
      </div>
    </main>
  )
}
