/**
 * POST /api/account/mfa/verify  { factorId, code } → { ok: true }
 *
 * 登録を始めた認証アプリの番号を確かめて有効にする (2026-10-29 にサーバへ・ASVS 3.3.4)。
 * 番号の総当たりは利用者ごとに 10 回/15 分で止める (ログインの番号と同じ枠)。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { rateLimitAllows, clientIp } from '@/lib/rate-limit'
import { authJson, normalizeTotp, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { logSecurityEvent } from '@/lib/security/events'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/account/mfa/verify')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)

  const body = await readJson(req)
  const factorId = typeof body?.factorId === 'string' ? body.factorId : ''
  const code = normalizeTotp(body?.code)
  if (!factorId || !code) return authJson({ error: 'bad_code' }, 400)
  if (!(await rateLimitAllows(createSupabaseService(), `mfa-verify:user:${user.id}`, 10, 15 * 60))) {
    return authJson({ error: 'too_many' }, 429)
  }
  const { error } = await supa.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    logSecurityEvent({ kind: 'auth.mfa_failed', actor: user.id, ip: clientIp(req), path: '/api/account/mfa/verify' })
    return authJson({ error: 'bad_code' }, 400)
  }
  return authJson({ ok: true })
}
