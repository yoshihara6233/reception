'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/useLocale'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(t('common.error'))
      setLoading(false)
      return
    }

    router.push('/admin/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[#1e3a5f] rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-xl">&#x1F6E1;</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Reception Kiosk</h1>
          <p className="text-sm text-gray-400 mt-1">{t('admin.loginSubtitle')}</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">
              {t('admin.emailLabel')}
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">
              {t('admin.passwordLabel')}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
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
            disabled={loading}
            className="w-full py-3 bg-[#1e3a5f] text-white rounded-[14px] font-semibold disabled:opacity-40"
          >
            {loading ? t('admin.loggingIn') : t('admin.loginButton')}
          </button>
        </form>
      </div>
    </div>
  )
}
