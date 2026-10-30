'use server'

/**
 * サインイン中の端末を切る (/account/sessions のボタン・2026-10-31・自主診断 ASVS 7.5.2)。
 *
 * 切れるのは**本人のセッションだけ** (本人の接続で DB の関数を呼び、関数が auth.uid() で絞る)。
 * 今の端末は 1 つ切りでは切らない (サインアウトで行う)。Server Action は Next が送り元 (Origin) を
 * 確かめるので、別のサイトから押させられない。誰が何台切ったかは監査ログに残す。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { validSessionId } from '@/lib/account/sessions'

const PAGE = '/account/sessions'

async function signedIn() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(PAGE)}`)
  return { supa, user }
}

export async function revokeSession(form: FormData) {
  const id = form.get('session_id')
  if (!validSessionId(id)) redirect(`${PAGE}?failed=1`)
  const { supa, user } = await signedIn()
  const { data, error } = await supa.rpc('revoke_my_session', { p_session: id })
  if (error || data !== 1) redirect(`${PAGE}?failed=1`)
  await recordAudit(supa, {
    actorUserId: user.id, action: 'session.revoke_own', targetType: 'user', targetId: user.id, storeId: null,
    changes: { session_id: id },
  })
  redirect(`${PAGE}?revoked=1`)
}

export async function revokeOtherSessions() {
  const { supa, user } = await signedIn()
  const { data, error } = await supa.rpc('revoke_my_other_sessions')
  if (error) redirect(`${PAGE}?failed=1`)
  const n = typeof data === 'number' ? data : 0
  await recordAudit(supa, {
    actorUserId: user.id, action: 'session.revoke_own_others', targetType: 'user', targetId: user.id, storeId: null,
    changes: { revoked: n },
  })
  redirect(`${PAGE}?revoked=${n}`)
}
