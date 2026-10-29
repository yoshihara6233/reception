/**
 * POST /api/auth/recovery/verify  { email, token } → { ok: true }
 *
 * パスワードの再設定のメールのリンクにある番号を確かめ、再設定のセッションを HttpOnly の Cookie に
 * 置く (2026-10-29 にブラウザからサーバへ・ASVS 3.3.4)。続きは /api/auth/recovery。
 *
 * 認証の入口なので閉じられない (無認証)。番号の総当たりを、メール 5 回/15 分・IP 20 回/時で止める。
 * 誤りの文は 1 種類 (アカウントの有無を教えない)。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { rateLimitAllows, clientIp } from '@/lib/rate-limit'
import { authJson, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { logSecurityEvent } from '@/lib/security/events'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/recovery/verify')
  if (cross) return cross
  const body = await readJson(req)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!email || !token || email.length > 320 || token.length > 64) return authJson({ error: 'invalid_link' }, 400)

  const ip = clientIp(req)
  const svc = createSupabaseService()
  const okEmail = await rateLimitAllows(svc, `recovery-verify:email:${email.toLowerCase()}`, 5, 15 * 60)
  const okIp = ip ? await rateLimitAllows(svc, `recovery-verify:ip:${ip}`, 20, 3600) : true
  if (!okEmail || !okIp) return authJson({ error: 'too_many' }, 429)

  const supa = await createSupabaseServer()
  const { error } = await supa.auth.verifyOtp({ email, token, type: 'recovery' })
  if (error) {
    logSecurityEvent({ kind: 'auth.recovery_failed', ip, path: '/api/auth/recovery/verify' })
    return authJson({ error: 'invalid_link' }, 400)
  }
  return authJson({ ok: true })
}
