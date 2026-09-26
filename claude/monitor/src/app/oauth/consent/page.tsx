/**
 * OAuth 2.1 Server の同意画面（ログインの一本化・GVMS_CLOUD_SPEC §9.5）。
 *
 * Supabase Auth は、拠点の G・VMS からの認可要求でここへ利用者を送る。**G・VMS の拠点の
 * クライアントは自社のものなので、確認を省いて承認する**（仕様 §9.5）。それ以外の
 * クライアント（登録していない第三者）は断る — 動的登録も無効にしている。
 * ログインしていなければログイン画面へ送り、ログイン後にここへ戻す。
 */
import { redirect } from 'next/navigation'
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function OAuthConsentPage(
  { searchParams }: { searchParams: Promise<{ authorization_id?: string }> },
) {
  const { authorization_id: id } = await searchParams
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return <main className="p-8 text-sm">認可の要求が正しくありません。拠点の画面からやり直してください。</main>
  }
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`)

  const { data, error } = await supa.auth.oauth.getAuthorizationDetails(id)
  if (error || !data) {
    return <main className="p-8 text-sm">認可の要求を読めません（期限切れの可能性があります）。拠点の画面からやり直してください。</main>
  }
  // 既に同意済みなら、そのまま拠点へ戻す
  if (!('client' in data)) redirect(data.redirect_url)
  const details = data as OAuthAuthorizationDetails
  const clientId = details.client.id
  const svc = createSupabaseService()
  const { data: gvms } = await svc.from('gvms_oidc_clients').select('edge_id').eq('client_id', clientId).maybeSingle()
  if (!gvms) {
    const { data: denied } = await supa.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
    if (denied?.redirect_url) redirect(denied.redirect_url)
    return <main className="p-8 text-sm">このアプリへのログインは許可されていません。</main>
  }
  const { data: ok, error: approveErr } = await supa.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
  if (approveErr || !ok?.redirect_url) {
    return <main className="p-8 text-sm">承認できませんでした。拠点の画面からやり直してください。</main>
  }
  redirect(ok.redirect_url)
}
