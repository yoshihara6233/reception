/**
 * OAuth 2.1 Server の同意画面（ログインの一本化・GVMS_CLOUD_SPEC §9.5）。
 *
 * Supabase Auth は、拠点の G・VMS からの認可要求でここへ利用者を送る。
 * **この画面は確かめるだけで、承認しない**（2026-10-29・自主診断 ASVS 7.6.2・10.7.1）。
 * どの拠点に何を渡すかを見せ、利用者が「サインインする」を押したとき（POST・actions.ts）だけ承認する。
 * その拠点に入れない利用者には承認のボタンを出さず、断る理由を出す（lib/edge/gvms-consent.ts）。
 * 登録していないクライアント（第三者）は断る — 動的登録も無効にしている。
 * ログインしていなければログイン画面へ送り、ログイン後にここへ戻す。
 *
 * 許可の期限 (2026-10-30・ASVS 10.4.9・10.7.2・lib/edge/gvms-grants.ts): 承認した許可は
 * GRANT_MAX_AGE_DAYS 日で切れる。認可の要求を読む前に、期限の過ぎた許可を本人の接続で取り消す
 * (Supabase は覚えている許可があると、要求を読んだ時点で承認して戻してしまうため、先に行う)。
 * 確かめられないときは、承認へ進まずに断る (期限の過ぎた許可で入れてしまわないように)。
 */
import { redirect } from 'next/navigation'
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { MonitorMark } from '@/components/MonitorMark'
import { PRODUCT_NAME } from '@/lib/brand'
import { consentTarget, GVMS_ROLE_LABEL, validAuthorizationId } from '@/lib/edge/gvms-consent'
import { activeGrants, formatJst, GRANT_MAX_AGE_DAYS, grantExpiresAt, nowIso } from '@/lib/edge/gvms-grants'
import { approveConsent, denyConsent } from './actions'

export const dynamic = 'force-dynamic'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-md border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-2">
          <MonitorMark className="h-8 w-8 flex-shrink-0 text-slate-900" accent="#2C4A7E" />
          <span className="text-lg font-bold text-slate-900">{PRODUCT_NAME}</span>
        </div>
        {children}
      </div>
    </main>
  )
}

function Message({ text }: { text: string }) {
  return <Shell><p className="text-sm text-slate-700">{text}</p></Shell>
}

export default async function OAuthConsentPage(
  { searchParams }: { searchParams: Promise<{ authorization_id?: string; failed?: string }> },
) {
  const { authorization_id: id, failed } = await searchParams
  if (!validAuthorizationId(id)) {
    return <Message text="認可の要求が正しくありません。拠点の画面からやり直してください。" />
  }
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`)

  // 期限の過ぎた許可を先に取り消す。取り消せない許可が残るなら、ここで止める
  const grants = await activeGrants(supa.auth.oauth)
  if (!grants || grants.some((g) => g.expired)) {
    return <Message text="サインインの許可の期限を確かめられませんでした。しばらくしてから、拠点の画面からやり直してください。" />
  }

  const { data, error } = await supa.auth.oauth.getAuthorizationDetails(id)
  if (error || !data) {
    return <Message text="認可の要求を読めません（期限切れの可能性があります）。拠点の画面からやり直してください。" />
  }
  // 既に同意済みなら、そのまま拠点へ戻す（Supabase が前の同意を覚えている）
  if (!('client' in data)) redirect(data.redirect_url)
  const details = data as OAuthAuthorizationDetails

  const t = await consentTarget(createSupabaseService(), details.client.id, user.id)
  if (!t.known) {
    const { data: denied } = await supa.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
    if (denied?.redirect_url) redirect(denied.redirect_url)
    return <Message text="このアプリへのログインは許可されていません。" />
  }
  const site = [t.storeName, t.edgeName].filter(Boolean).join('・') || '拠点'

  return (
    <Shell>
      <h1 className="text-sm font-bold text-slate-900">G・VMS へのサインイン</h1>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">サインイン先</dt>
          <dd className="text-slate-900">{site}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">アカウント</dt>
          <dd className="break-all text-slate-900">{user.email ?? user.id}</dd>
        </div>
        {t.role && (
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">拠点での役割</dt>
            <dd className="text-slate-900">{GVMS_ROLE_LABEL[t.role]}</dd>
          </div>
        )}
        {t.role && (
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">許可の期限</dt>
            <dd className="text-slate-900">
              承認から {GRANT_MAX_AGE_DAYS} 日（<span className="font-mono tabular-nums">{formatJst(grantExpiresAt(nowIso()))}</span> まで）
            </dd>
          </div>
        )}
      </dl>
      {t.role ? (
        <>
          <p className="text-xs leading-relaxed text-slate-500">
            この拠点の G・VMS に、メールアドレスと拠点での役割を渡してサインインします。
            渡すのはこの 2 つだけで、{PRODUCT_NAME} の操作には使えません。
            拠点へ渡す証明（アクセストークン）の有効時間は 1 時間で、更新のためのトークンは渡しません。
            拠点の画面に入ったあとは、拠点のセッションの決まりで続きます。
          </p>
          <p className="text-xs leading-relaxed text-slate-500">
            期限までは、この拠点へのサインインで確認を省きます。期限の前でも、アカウントの画面の
            「拠点へのサインインの許可」からいつでも取り消せます。
          </p>
          {failed && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">承認できませんでした。もう一度押すか、拠点の画面からやり直してください。</p>}
          <form action={approveConsent}>
            <input type="hidden" name="authorization_id" value={id} />
            <button type="submit"
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              サインイン
            </button>
          </form>
        </>
      ) : (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          このアカウントには、この拠点に入る権限がありません。管理者に担当の店舗を確かめてもらってください。
        </p>
      )}
      <form action={denyConsent} className="text-center">
        <input type="hidden" name="authorization_id" value={id} />
        <button type="submit" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
          {t.role ? "キャンセル" : "拠点の画面へ戻る"}
        </button>
      </form>
    </Shell>
  )
}
