/**
 * 自分の多要素認証の登録と解除 (/account/security の画面が使う・2026-10-29 にサーバへ・ASVS 3.3.4)。
 *
 * GET    → { factors: [{ id, friendly_name, created_at }] }   確かめ済みの認証アプリ
 * POST   → { id, uri, secret }   登録を始める (途中でやめた登録は先に消す)。uri を QR コードにして読ませる
 * DELETE ?factorId=… → { ok: true }   外す (Supabase の決まりで aal2 のセッションでだけ)
 * 確かめは /api/account/mfa/verify。
 *
 * /api/account は middleware の多要素の確認の内側 (番号を済ませていない人は 401)。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { MFA_REQUIRED_ROLES } from '@/lib/auth/mfa'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)
  const { data, error } = await supa.auth.mfa.listFactors()
  if (error) return authJson({ error: 'mfa_unavailable' }, 500)
  const factors = (data?.totp ?? []).map((f) => ({ id: f.id, friendly_name: f.friendly_name ?? null, created_at: f.created_at }))
  return authJson({ factors })
}

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/account/mfa')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)

  // 途中でやめた登録が残っていると、同じ名前で作れないことがあるので先に消す
  const { data: all } = await supa.auth.mfa.listFactors()
  for (const f of all?.all ?? []) {
    if (f.status === 'unverified') await supa.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})
  }
  const stamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const { data, error } = await supa.auth.mfa.enroll({ factorType: 'totp', friendlyName: `認証アプリ ${stamp}` })
  if (error || !data || data.type !== 'totp') return authJson({ error: '登録を始められません' }, 500)
  return authJson({ id: data.id, uri: data.totp.uri, secret: data.totp.secret })
}

export async function DELETE(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/account/mfa')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)
  const factorId = req.nextUrl.searchParams.get('factorId') ?? ''
  if (!factorId) return authJson({ error: 'bad_request' }, 400)
  // 必須の役割は、確認済みの最後の 1 つを外せない (途中でやめた登録の取り消しは通す)
  const verified = (user.factors ?? []).filter((f) => f.status === 'verified')
  if (verified.length === 1 && verified[0].id === factorId) {
    const { data: role } = await supa.rpc('auth_user_role')
    if (typeof role === 'string' && MFA_REQUIRED_ROLES.includes(role)) {
      return authJson({ error: '管理者は多要素認証が必須のため、最後の認証アプリは外せません。先に別の認証アプリを登録してください。' }, 400)
    }
  }
  const { error } = await supa.auth.mfa.unenroll({ factorId })
  if (error) return authJson({ error: '外せませんでした。もう一度ログインしてからお試しください。' }, 400)
  return authJson({ ok: true })
}
