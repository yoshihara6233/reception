'use client'

/**
 * /login/mfa — 多要素認証の番号を確かめる（2026-10-28・lib/auth/mfa.ts）。
 *
 * 多要素を登録した人は、パスワードのあとにここで認証アプリの 6 桁の番号を入れる。
 * 確かめるとトークンが aal2 になり、middleware が画面と API を通すようになる。
 * 戻り先 (next) はログインと同じく safeNext で絞る（拠点の SSO の同意画面だけが残る）。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'
import { safeNext } from '@/lib/auth/safe-next'

interface Factor { id: string; friendly_name?: string | null }

export default function LoginMfaPage() {
  const router   = useRouter()
  const supabase = createSupabaseBrowser()
  const [factors, setFactors] = useState<Factor[] | null>(null)
  const [factorId, setFactorId] = useState('')
  const [code, setCode]     = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)

  const next = () => safeNext(new URL(window.location.href).searchParams.get('next'))

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (!alive) return
      if (error) { setError(error.message); setFactors([]); return }
      const totp = (data?.totp ?? []) as Factor[]
      // 多要素を登録していない人がここへ来たら、そのまま戻り先へ
      if (totp.length === 0) { router.replace(next()); return }
      setFactors(totp)
      setFactorId(totp[0].id)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
    setBusy(false)
    if (error) {
      setError('番号が違います。認証アプリに今出ている番号を入れてください（端末の時刻がずれていると合いません）。')
      return
    }
    router.push(next())
    router.refresh()
  }

  async function onSignOut() {
    await supabase.auth.signOut().catch(() => {})
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <p className="text-xs text-slate-500">認証アプリに出ている 6 桁の番号を入れてください。</p>

        {factors && factors.length > 1 && (
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">認証アプリ</label>
            <select value={factorId} onChange={(e) => setFactorId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {factors.map((f) => <option key={f.id} value={f.id}>{f.friendly_name || f.id.slice(0, 8)}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">確認の番号</label>
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
                 onChange={(e) => setCode(e.target.value)}
                 className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-blue-500" />
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <button type="submit" disabled={busy || !factorId || code.replace(/\D/g, '').length !== 6}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? '確認中…' : '確認'}
        </button>

        <p className="text-[11px] leading-relaxed text-slate-500">
          端末を無くしたときは、管理者に多要素認証の解除を依頼してください。
        </p>
        <p className="text-center">
          <button type="button" onClick={onSignOut} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
            別のアカウントでログイン
          </button>
        </p>
      </form>
    </main>
  )
}
