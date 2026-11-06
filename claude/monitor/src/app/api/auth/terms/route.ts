/**
 * 利用約款への同意 (/login/terms の画面が使う・2026-11-06・G-9・約款の本体 第 4 条 2 項・3 項)。
 *
 * GET  → { required: boolean, version: string | null, url: string }
 * POST { version } → { ok: true }   同意を記録し、セッションを新しくする
 *
 * /api/auth は middleware の関門の外 (同意する前に呼ぶため)。ログインしていない要求は 401。
 * 多要素を登録している人は、番号を確かめてから (aal2) でないと記録しない。
 * 記録 (terms_consents) は本人には書けないので、書くのはサービスの接続で行う。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { authJson, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { mfaPending } from '@/lib/auth/mfa'
import { termsRequiredForRole, termsUrl, termsVersion } from '@/lib/auth/terms'
import { requestIp } from '@/lib/security/events'

export const dynamic = 'force-dynamic'

/** この利用者に今の版への同意を求めるか (テナント管理者で、本人がまだ同意していない)。 */
async function required(supa: Awaited<ReturnType<typeof createSupabaseServer>>, userId: string): Promise<boolean> {
  const version = termsVersion()
  if (!version) return false
  const { data: role } = await supa.rpc('auth_user_role')
  if (!termsRequiredForRole(role as string | null)) return false
  const { data } = await createSupabaseService().from('terms_consents').select('id')
    .eq('user_id', userId).eq('terms_version', version).limit(1)
  return (data ?? []).length === 0
}

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)
  const version = termsVersion()
  return authJson({ required: await required(supa, user.id), version: version || null, url: termsUrl() })
}

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/terms')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'ログインし直してください。' }, 401)

  const version = termsVersion()
  if (!version) return authJson({ error: '同意を求める約款がありません。' }, 409)
  const body = await readJson(req)
  // 画面に出した版と今の版が違えば断る (開いているあいだに版が変わった)
  if (typeof body?.version !== 'string' || body.version.trim() !== version) {
    return authJson({ error: '約款の版が変わりました。画面を読み込み直してください。' }, 409)
  }
  const { data: { session } } = await supa.auth.getSession()
  if (mfaPending(user, session?.access_token ?? null)) {
    return authJson({ error: '先に認証アプリの番号を確かめてください。' }, 401)
  }
  const { data: role } = await supa.rpc('auth_user_role')
  if (!termsRequiredForRole(role as string | null)) return authJson({ ok: true })   // 求めない役割
  if (!(await required(supa, user.id))) return authJson({ ok: true })               // 押し直し

  const { data: tenantId } = await supa.rpc('auth_user_tenant_id')
  const { error } = await createSupabaseService().from('terms_consents').insert({
    terms_version: version, user_id: user.id, tenant_id: (tenantId as string | null) ?? null,
    ip: requestIp(req.headers) ?? '', user_agent: (req.headers.get('user-agent') ?? '').slice(0, 512),
  })
  if (error) return authJson({ error: '同意を記録できませんでした。時間をおいてお試しください。' }, 500)
  // トークンを新しくする (middleware の判定はトークンごとに 30 秒覚えているため、古いトークンだと
  // 同意した直後もこの画面へ戻される)
  await supa.auth.refreshSession().catch(() => {})
  return authJson({ ok: true })
}
