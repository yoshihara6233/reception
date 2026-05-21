'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/admin/auth/reset-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/admin/reset-password`,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.action_link) {
        setError(data.error ?? '送信に失敗しました。メールアドレスを確認してください。')
        setSubmitting(false)
        return
      }

      // 生成されたリンクに直接リダイレクト（メール経由不要）
      window.location.href = data.action_link
    } catch {
      setError('ネットワークエラーが発生しました')
      setSubmitting(false)
    }
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
              {submitting ? '処理中...' : 'パスワードをリセット'}
            </button>

            <button
              type="button"
              onClick={() => router.push('/admin/login')}
              className="w-full py-2 text-gray-400 text-sm"
            >
              ログイン画面に戻る
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
