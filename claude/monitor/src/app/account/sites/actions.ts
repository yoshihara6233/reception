'use server'

/**
 * 拠点へのサインインの許可の取り消し (/account/sites のボタン・2026-10-30・ASVS 10.4.9)。
 *
 * 取り消すのは**本人の許可だけ** (本人のセッションの接続で revokeGrant を呼ぶ。Supabase が
 * その利用者とクライアントの組の同意を取り消し、その拠点向けのセッションと refresh トークンを消す)。
 * Server Action は Next が送り元 (Origin) を確かめるので、別のサイトから押させられない。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { grantSites, validClientId } from '@/lib/edge/gvms-grants'

export async function revokeSiteGrant(form: FormData) {
  const clientId = form.get('client_id')
  if (!validClientId(clientId)) redirect('/account/sites?failed=1')
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent('/account/sites')}`)

  const { error } = await supa.auth.oauth.revokeGrant({ clientId })
  if (error) redirect('/account/sites?failed=1')

  // 誰がどの拠点の許可を取り消したかを残す (テナントの管理者が監査の画面で見られる)
  const site = (await grantSites(createSupabaseService(), [clientId])).get(clientId)
  await recordAudit(supa, {
    actorUserId: user.id,
    action: 'sso_grant.revoke',
    targetType: 'edge',
    targetId: site?.edgeId ?? null,
    storeId: site?.storeId ?? null,
    changes: { client_id: clientId },
  })
  redirect('/account/sites?revoked=1')
}
