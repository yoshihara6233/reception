'use client'

/**
 * /account/security — 多要素認証の登録と解除（利用者が自分で行う・2026-10-28・lib/auth/mfa.ts）。
 *
 * 認証アプリ（Google Authenticator・Microsoft Authenticator など）に QR コードを読ませ、
 * 出た 6 桁の番号で確かめると有効になる。予備の端末として 2 つ目を登録してもよい。
 * 登録した人は、次からログインのたびに番号を求められる。
 *
 * - 登録の途中でやめた（確かめていない）ものは、次に登録を始めるときに消す。
 * - 外すのは、番号を確かめたあとのセッション（aal2）でだけできる（Supabase の決まり）。
 *   多要素を登録した人は middleware が aal2 でないと通さないので、ここに来られた時点で満たす。
 * - 端末を無くしたら、管理者が本人を確かめてから外す（/api/admin/users/[id]/mfa-reset）。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { authFetch } from '@/lib/auth/post-json'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'

interface Factor { id: string; friendly_name?: string | null; created_at?: string; status?: string }
interface Enrolling { id: string; uri: string; secret: string }

export default function AccountSecurityPage() {
  const [factors, setFactors] = useState<Factor[] | null>(null)
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { status, data } = await authFetch('/api/account/mfa', 'GET')
    if (status === 401) { window.location.href = '/login'; return }
    if (status !== 200) { setError('認証アプリの一覧を読めませんでした。'); setFactors([]); return }
    setFactors((data.factors ?? []) as Factor[])
  }, [])
  useEffect(() => { void load() }, [load])

  async function startEnroll() {
    setError(null); setNotice(null); setBusy(true)
    try {
      // 途中でやめた登録の片付けと登録の開始はサーバで (/api/account/mfa)
      const { status, data } = await authFetch('/api/account/mfa', 'POST')
      if (status !== 200) { setError(typeof data.error === 'string' ? data.error : '登録を始められません'); return }
      setEnrolling({ id: String(data.id), uri: String(data.uri), secret: String(data.secret) })
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll() {
    if (!enrolling) return
    setError(null); setBusy(true)
    const { status } = await authFetch('/api/account/mfa/verify', 'POST', { factorId: enrolling.id, code })
    setBusy(false)
    if (status === 429) { setError('番号の試行が多すぎます。しばらく待ってからお試しください。'); return }
    if (status !== 200) { setError('番号が違います。認証アプリに今出ている番号を入れてください。'); return }
    setEnrolling(null)
    setNotice('登録しました。次からログインのたびに、認証アプリの番号を求めます。')
    await load()
  }

  async function cancelEnroll() {
    if (enrolling) await authFetch(`/api/account/mfa?factorId=${encodeURIComponent(enrolling.id)}`, 'DELETE')
    setEnrolling(null)
  }

  async function remove(f: Factor) {
    const last = (factors ?? []).length <= 1
    const msg = last
      ? 'この認証アプリを外すと、ログインはパスワードだけになります。外しますか？'
      : 'この認証アプリを外しますか？'
    if (!confirm(msg)) return
    setError(null); setNotice(null); setBusy(true)
    const { status, data } = await authFetch(`/api/account/mfa?factorId=${encodeURIComponent(f.id)}`, 'DELETE')
    setBusy(false)
    if (status !== 200) { setError(typeof data.error === 'string' ? data.error : '外せませんでした。'); return }
    setNotice('外しました。')
    await load()
  }

  return (
    <main className="relative flex min-h-screen items-start justify-center bg-slate-900 p-6 pt-16">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-lg space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-base font-bold text-slate-900">多要素認証</h1>
        <p className="text-xs leading-relaxed text-slate-600">
          ログインのときに、パスワードに加えて認証アプリ（Google Authenticator・Microsoft Authenticator など）の
          6 桁の番号を入れるようにします。使うかどうかは選べます。拠点の G・VMS に「組織アカウントでサインイン」で入るときも、
          ここで登録していれば番号を確かめてから入ります。
        </p>

        {factors && factors.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">登録した認証アプリ</div>
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {factors.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-3 py-2 text-sm text-slate-800">
                  <span>{f.friendly_name || f.id.slice(0, 8)}</span>
                  <button type="button" onClick={() => remove(f)} disabled={busy}
                          className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                    外す
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {factors && factors.length === 0 && !enrolling && (
          <p className="text-sm text-slate-700">いまは使っていません（ログインはパスワードだけ）。</p>
        )}

        {enrolling ? (
          <div className="space-y-3 rounded-md border border-slate-200 p-4">
            <p className="text-xs text-slate-600">認証アプリでこの QR コードを読み取ります。</p>
            <div className="flex justify-center rounded bg-white p-3">
              <QRCodeSVG value={enrolling.uri} size={176} level="M" marginSize={2} />
            </div>
            <p className="text-[11px] text-slate-500">読み取れないときは、次の鍵を手で入れます（時間ベース・6 桁）。</p>
            <code className="block break-all font-mono text-xs text-slate-700">{enrolling.secret}</code>
            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">認証アプリに出た 6 桁の番号</label>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
                     onChange={(e) => setCode(e.target.value)}
                     className="w-40 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-blue-500" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={confirmEnroll} disabled={busy || code.replace(/\D/g, '').length !== 6}
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                登録する
              </button>
              <button type="button" onClick={cancelEnroll} disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={startEnroll} disabled={busy || factors === null}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {factors && factors.length > 0 ? '予備の認証アプリを登録する' : '認証アプリを登録する'}
          </button>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}

        <p className="text-[11px] leading-relaxed text-slate-500">
          端末を無くしたときは、管理者に多要素認証の解除を依頼してください（管理者は本人であることを確かめてから外します）。
          予備の端末を登録しておくと、1 台を無くしても入れます。
        </p>
        <p><Link href="/stores" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">戻る</Link></p>
      </div>
    </main>
  )
}
