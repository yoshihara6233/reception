'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MonitorMark } from '@/components/MonitorMark'

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createSupabaseBrowser()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)

  // QR target URL — populated after mount because we need window.location.
  // For localhost access we hint the user to use the LAN IP from a phone.
  const [qrUrl, setQrUrl]   = useState<string>('')
  const [isLocal, setIsLocal] = useState(false)

  useEffect(() => {
    const u = new URL(window.location.href)
    // Strip query/hash so the QR points at the canonical /login URL
    const cleanUrl = `${u.protocol}//${u.host}/login`
    setQrUrl(cleanUrl)
    setIsLocal(['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname))
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setError(error.message)
    router.push('/stores')
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>

      <div className="flex w-full max-w-3xl flex-col items-stretch gap-6 md:flex-row md:items-stretch">
        {/* Login form */}
        <form
          onSubmit={onSubmit}
          className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-2xl"
        >
          <div className="flex items-center gap-2">
            <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
            <span className="text-lg font-bold text-slate-900">Recorder Monitor</span>
          </div>
          <p className="text-xs text-slate-500">本部監視オペレータ向けログイン</p>

          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">メールアドレス</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">パスワード</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <button type="submit" disabled={busy}
                  className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? '認証中…' : 'ログイン'}
          </button>

          <p className="text-center">
            <Link href="/forgot-password" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
              パスワードをお忘れの方はこちら
            </Link>
          </p>
        </form>

        {/* QR code panel for mobile access */}
        <aside className="flex w-full max-w-[16rem] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl md:max-w-[18rem]">
          <h2 className="text-sm font-bold text-slate-900">📱 スマホでアクセス</h2>
          <p className="text-[11px] text-slate-500 text-center">
            このページを QR コードで読み取って、お手元のスマートフォンからアクセスできます。
          </p>

          {qrUrl ? (
            <div className="rounded-lg bg-white p-3 shadow-inner ring-1 ring-slate-200">
              <QRCodeSVG
                value={qrUrl}
                size={160}
                level="M"
                marginSize={1}
              />
            </div>
          ) : (
            <div className="flex h-[160px] w-[160px] items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
              読み込み中...
            </div>
          )}

          <p className="break-all text-center text-[10px] font-mono text-slate-500">
            {qrUrl || '...'}
          </p>

          {isLocal && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] leading-relaxed text-amber-900">
                ⚠️ <b>localhost</b> はスマホからアクセスできません。
                Mac の LAN IP (例: <code className="font-mono">http://192.168.0.2:3100/login</code>) に
                ブラウザで一度アクセスし直してから QR コードを表示してください。
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
