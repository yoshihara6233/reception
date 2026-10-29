/**
 * /account/sites — 拠点 (G・VMS) へのサインインの許可の一覧と取り消し
 * (2026-10-30・自主診断 ASVS 10.4.9・10.7.2・lib/edge/gvms-grants.ts)。
 *
 * 「組織アカウントでサインイン」で拠点の G・VMS に入るとき、最初に同意の画面で承認した拠点を
 * Supabase が覚えている。ここでは本人の許可を一覧にし、許可した日時・期限を出し、拠点ごとに
 * 取り消せるようにする。期限の過ぎた許可は、この画面を開いたときにも取り消す。
 *
 * 取り消すと、次にその拠点でサインインするときに同意の画面がもう一度出る。拠点の画面に
 * すでに入っている分は、拠点のセッションの決まり (ログアウトか拠点の期限) で終わる
 * (拠点はクラウドへ確かめに来ないため・GVMS_CLOUD_SPEC §9.5)。
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { MonitorMark } from '@/components/MonitorMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRODUCT_NAME } from '@/lib/brand'
import { activeGrants, formatJst, GRANT_MAX_AGE_DAYS, grantExpiresAt, grantSites } from '@/lib/edge/gvms-grants'
import { revokeSiteGrant } from './actions'

export const dynamic = 'force-dynamic'

export default async function AccountSitesPage(
  { searchParams }: { searchParams: Promise<{ revoked?: string; failed?: string }> },
) {
  const { revoked, failed } = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent('/account/sites')}`)

  const grants = await activeGrants(supa.auth.oauth)
  const sites = grants ? await grantSites(createSupabaseService(), grants.map((g) => g.grant.client.id)) : new Map()

  return (
    <main className="relative flex min-h-screen items-start justify-center bg-slate-900 p-6 pt-16">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-lg space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-base font-bold text-slate-900">拠点へのサインインの許可</h1>
        <p className="text-xs leading-relaxed text-slate-600">
          拠点の G・VMS に「組織アカウントでサインイン」で入るとき、確認の画面で承認した拠点の一覧です。
          承認した拠点には、期限まで確認を省いてサインインします。渡すのはメールアドレスと拠点での役割だけです。
          許可の期限は承認から {GRANT_MAX_AGE_DAYS} 日で、過ぎると次のサインインで確認の画面がもう一度出ます。
        </p>

        {grants === null && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">許可の一覧を読めませんでした。しばらくしてから開き直してください。</p>
        )}
        {grants && grants.length === 0 && (
          <p className="text-sm text-slate-700">許可した拠点はありません。</p>
        )}
        {grants && grants.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {grants.map(({ grant, expired }) => {
              const site = sites.get(grant.client.id)
              return (
                <li key={grant.client.id} className="space-y-2 px-3 py-3 text-sm text-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <span className="break-all font-medium text-slate-900">{site?.label ?? grant.client.name ?? '拠点'}</span>
                    <form action={revokeSiteGrant}>
                      <input type="hidden" name="client_id" value={grant.client.id} />
                      <button type="submit"
                              className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50">
                        取り消す
                      </button>
                    </form>
                  </div>
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-slate-500">許可した日時</dt>
                    <dd className="font-mono tabular-nums text-slate-700">{formatJst(grant.granted_at)}</dd>
                    <dt className="text-slate-500">期限</dt>
                    <dd className="font-mono tabular-nums text-slate-700">
                      {formatJst(grantExpiresAt(grant.granted_at))}
                      {expired && <span className="ml-2 font-sans text-red-600">期限切れ（取り消してください）</span>}
                    </dd>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}

        {revoked && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">取り消しました。次にその拠点でサインインするときは、確認の画面がもう一度出ます。</p>}
        {failed && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">取り消せませんでした。もう一度お試しください。</p>}

        <p className="text-[11px] leading-relaxed text-slate-500">
          取り消しても、拠点の画面にすでに入っている分はすぐには終わりません。拠点の画面でサインアウトするか、
          拠点のセッションの期限で終わります。拠点に入れないようにしたいときは、管理者に担当の店舗の見直しを依頼してください（担当から外れると、次のサインインから入れません）。
        </p>
        <p className="flex gap-4">
          <Link href="/account/security" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">多要素認証</Link>
          <Link href="/stores" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">戻る</Link>
        </p>
      </div>
    </main>
  )
}
