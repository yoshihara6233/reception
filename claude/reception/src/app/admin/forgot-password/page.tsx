'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    })

    if (err) {
      setError('送信に失敗しました。メールアドレスを確認してください。')
      setSubmitting(false)
      return
    }

    setSent(true)
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[#1e3a5f] rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-xl">&#x1F511;</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">パスワードをお忘れの方</h1>
          <p className="text-sm text-gray-400 mt-1">登録済みのメールアドレスを入力してください</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <span className="text-2xl">&#x2709;&#xFE0F;</span>
              </div>
              <p className="text-gray-700 text-sm font-medium">再設定メールを送信しました</p>
              <p className="text-gray-400 text-xs leading-relaxed">
                {email} 宛にパスワード再設定用のリンクを送りました。<br />
                メールが届かない場合は迷惑メールフォルダをご確認ください。
              </p>
              <button
                onClick={() => router.push('/admin/login')}
                className="w-full py-3 bg-[#1e3a5f] text-white rounded-[14px] font-semibold mt-2"
              >
                ログイン画面に戻る
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#1e3a5f] mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  autoComplete="email"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 rounded-xl p-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[#1e3a5f] text-white rounded-[14px] font-semibold disabled:opacity-40"
              >
                {submitting ? '送信中...' : '再設定メールを送信'}
              </button>

              <button
                type="button"
                onClick={() => router.push('/admin/login')}
                className="w-full py-2 text-gray-400 text-sm"
              >
                ログイン画面に戻る
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
