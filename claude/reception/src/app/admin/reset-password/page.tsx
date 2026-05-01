'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let resolved = false

    async function bootstrap() {
      const code = new URL(window.location.href).searchParams.get('code')
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exErr) {
          if (!cancelled) setSessionError('リンクが無効または期限切れです。もう一度お試しください。')
          return
        }
      }
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) {
        resolved = true
        setReady(true)
      } else {
        // Wait briefly for PASSWORD_RECOVERY event from detectSessionInUrl
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            resolved = true
            setReady(true)
            sub.subscription.unsubscribe()
          }
        })
        setTimeout(() => {
          if (!cancelled && !resolved) {
            setSessionError('リンクが無効または期限切れです。もう一度お試しください。')
          }
        }, 3000)
      }
    }
    bootstrap()

    return () => { cancelled = true }

  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください')
      return
    }
    if (password !== confirm) {
      setError('パスワードが一致しません')
      return
    }
    setSubmitting(true)
    setError(null)
    const supabase = createClient()
    const { error: upErr } = await supabase.auth.updateUser({ password })
    if (upErr) {
      setError(upErr.message)
      setSubmitting(false)
      return
    }
    setDone(true)
    setSubmitting(false)
    setTimeout(() => router.push('/admin/login'), 1500)
  }

  return (
    <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[var(--ge-accent)] rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-xl">&#x1F511;</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--ge-accent)]">パスワード再設定</h1>
          <p className="text-sm text-gray-400 mt-1">新しいパスワードを入力してください</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          {sessionError ? (
            <div className="space-y-4">
              <p className="text-red-600 text-sm">{sessionError}</p>
              <button
                onClick={() => router.push('/admin/login')}
                className="w-full py-3 bg-[var(--ge-accent)] text-white rounded-[14px] font-semibold"
              >
                ログイン画面に戻る
              </button>
            </div>
          ) : !ready ? (
            <p className="text-sm text-gray-400 text-center py-6">読み込み中...</p>
          ) : done ? (
            <div className="text-center py-4">
              <p className="text-emerald-600 text-sm font-medium">パスワードを変更しました</p>
              <p className="text-xs text-gray-400 mt-2">ログイン画面へ移動します...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ge-accent)] mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8文字以上"
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ge-accent)] mb-1">パスワード（確認）</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="もう一度入力"
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 rounded-xl p-3 text-sm">{error}</div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[var(--ge-accent)] text-white rounded-[14px] font-semibold disabled:opacity-40"
              >
                {submitting ? '変更中...' : 'パスワードを変更'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
