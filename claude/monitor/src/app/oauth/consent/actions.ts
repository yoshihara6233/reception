'use server'

/**
 * 同意の画面のボタン (承認・断る)。**承認はここ (POST) でだけ行う** (lib/edge/gvms-consent.ts)。
 * Server Action は Next が送り元 (Origin) を確かめるので、別のサイトから押させられない。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { consentTarget, validAuthorizationId } from '@/lib/edge/gvms-consent'

async function load(form: FormData) {
  const id = form.get('authorization_id')
  if (!validAuthorizationId(id)) redirect('/oauth/consent')
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`)
  return { id, supa, user }
}

export async function approveConsent(form: FormData) {
  const { id, supa, user } = await load(form)
  const { data, error } = await supa.auth.oauth.getAuthorizationDetails(id)
  if (error || !data) redirect(`/oauth/consent?authorization_id=${id}`)
  if (!('client' in data)) redirect(data.redirect_url)
  // 押したときにもう一度確かめる (画面を開いてから役割が外された場合も断る)
  const t = await consentTarget(createSupabaseService(), data.client.id, user.id)
  if (!t.known || !t.role) {
    const { data: denied } = await supa.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
    redirect(denied?.redirect_url ?? `/oauth/consent?authorization_id=${id}`)
  }
  const { data: ok, error: approveErr } = await supa.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
  if (approveErr || !ok?.redirect_url) redirect(`/oauth/consent?authorization_id=${id}&failed=1`)
  redirect(ok.redirect_url)
}

export async function denyConsent(form: FormData) {
  const { id, supa } = await load(form)
  const { data: denied } = await supa.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
  redirect(denied?.redirect_url ?? '/')
}
