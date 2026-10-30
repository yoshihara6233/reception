/**
 * /account/sessions — サインイン中の端末の一覧と切断 (2026-10-31・自主診断 ASVS 7.5.2)。
 *
 * 本人がどの端末でサインインしたままかを見て、1 つずつ・今の端末以外をまとめて切れるようにする。
 * 端末を無くした・共用の端末で切り忘れたときのため。それまでは管理者が利用者を指定して全部を
 * 切るしかなかった (/admin/users の「セッションを切る」)。
 *
 * 一覧と切断は DB の関数 (my_sessions・revoke_my_session・revoke_my_other_sessions) が本人の分
 * だけを扱う。切った端末は次の操作でサインインの画面へ戻る (トークンの更新が断られ、DB も
 * 切ったセッションのトークンを断る)。
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'
import { formatJst } from '@/lib/edge/gvms-grants'
import { deviceLabel, type MySession } from '@/lib/account/sessions'
import { revokeOtherSessions, revokeSession } from './actions'

export const dynamic = 'force-dynamic'

export default async function AccountSessionsPage(
  { searchParams }: { searchParams: Promise<{ revoked?: string; failed?: string }> },
) {
  const { revoked, failed } = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent('/account/sessions')}`)

  const { data, error } = await supa.rpc('my_sessions')
  const sessions = error ? null : ((data ?? []) as MySession[])
  const others = sessions ? sessions.filter((s) => !s.current).length : 0

  return (
    <main className="relative flex min-h-screen items-start justify-center bg-slate-900 p-6 pt-16">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-lg space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-base font-bold text-slate-900">サインイン中の端末</h1>
        <p className="text-xs leading-relaxed text-slate-600">
          このアカウントでサインインしたままの端末の一覧です。覚えのない端末や、使わなくなった端末は切ってください。
          切った端末は、次の操作でサインインの画面に戻ります。今お使いの端末は、サインアウトで終えてください。
        </p>

        {sessions === null && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">端末の一覧を読めませんでした。しばらくしてから開き直してください。</p>
        )}
        {sessions && sessions.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {sessions.map((s) => (
              <li key={s.id} className="space-y-2 px-3 py-3 text-sm text-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-slate-900">
                    {deviceLabel(s.user_agent)}
                    {s.current && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">この端末</span>}
                  </span>
                  {!s.current && (
                    <form action={revokeSession}>
                      <input type="hidden" name="session_id" value={s.id} />
                      <button type="submit"
                              className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50">
                        切る
                      </button>
                    </form>
                  )}
                </div>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500">最後に使った日時</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{formatJst(s.last_seen)}</dd>
                  <dt className="text-slate-500">サインインした日時</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{formatJst(s.created_at)}</dd>
                  <dt className="text-slate-500">接続元</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{s.ip ?? '—'}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}

        {sessions && others > 0 && (
          <form action={revokeOtherSessions}>
            <button type="submit"
                    className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
              この端末以外をすべて切る（{others} 台）
            </button>
          </form>
        )}

        {revoked && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">切りました。その端末は、次の操作でサインインの画面に戻ります。</p>}
        {failed && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">切れませんでした。一覧を開き直してから、もう一度お試しください。</p>}

        <p className="flex gap-4">
          <Link href="/account/security" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">多要素認証</Link>
          <Link href="/account/sites" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">拠点へのサインインの許可</Link>
          <Link href="/stores" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">戻る</Link>
        </p>
      </div>
    </main>
  )
}
