/**
 * POST /api/auth/login  { email, password } → { ok: true, mfa: boolean }
 *
 * ログインをサーバで行い、セッションを HttpOnly の Cookie に置く (2026-10-29・ASVS 3.3.4・
 * lib/supabase/cookie-options.ts)。多要素を登録した人は mfa: true を返し、画面は /login/mfa へ進む。
 *
 * 認証の入口なので閉じられない (無認証)。代わりに:
 *   - 同じサイトの画面からの JSON だけを受ける (ログインの CSRF・lib/security/same-origin.ts)
 *   - 回数で縛る (メール 10 回/15 分・IP 30 回/15 分)。Supabase の回数の制限は送り元の IP
 *     (ここでは Vercel) で数えるため、利用者ごとの制限はこちらで持つ
 *   - 誤りの文は 1 種類にする (アカウントの有無を教えない)
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { rateLimitAllows, clientIp } from '@/lib/rate-limit'
import { authJson, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { logSecurityEvent } from '@/lib/security/events'

export const dynamic = 'force-dynamic'

const PER_EMAIL_LIMIT = 10
const PER_IP_LIMIT    = 30
const WINDOW_SECONDS  = 15 * 60
const BAD_CREDENTIALS = 'メールアドレスかパスワードが違います。'

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/login')
  if (cross) return cross
  const body = await readJson(req)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return authJson({ error: BAD_CREDENTIALS }, 400)
  }

  const ip = clientIp(req)
  const svc = createSupabaseService()
  const okEmail = await rateLimitAllows(svc, `login:email:${email.toLowerCase()}`, PER_EMAIL_LIMIT, WINDOW_SECONDS)
  const okIp = ip ? await rateLimitAllows(svc, `login:ip:${ip}`, PER_IP_LIMIT, WINDOW_SECONDS) : true
  if (!okEmail || !okIp) {
    return authJson({ error: 'ログインの試行が多すぎます。しばらく待ってからお試しください。' }, 429)
  }

  const supa = await createSupabaseServer()
  const { data, error } = await supa.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    logSecurityEvent({ kind: 'auth.login_failed', ip, path: '/api/auth/login' })
    return authJson({ error: BAD_CREDENTIALS }, 401)
  }

  // 多要素を登録している人は、番号を確かめる画面へ (lib/auth/mfa.ts)
  const { data: aal } = await supa.auth.mfa.getAuthenticatorAssuranceLevel()
  const mfa = !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2'
  return authJson({ ok: true, mfa })
}
