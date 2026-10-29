/**
 * ログインの途中の多要素の番号の確認 (/login/mfa の画面が使う・2026-10-29 にサーバへ・ASVS 3.3.4)。
 *
 * GET  → { factors: [{ id, friendly_name }] }   確かめ済みの認証アプリ
 * POST { factorId, code } → { ok: true }        番号が合えばセッションが aal2 になる (Cookie を書き換える)
 *
 * /api/auth は middleware の多要素の確認の外 (番号を入れる前に呼ぶため)。ログインしていない要求は
 * 401。番号の総当たりは利用者ごとに 10 回/15 分で止める。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { rateLimitAllows, clientIp } from '@/lib/rate-limit'
import { authJson, normalizeTotp, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { logSecurityEvent } from '@/lib/security/events'

export const dynamic = 'force-dynamic'

const VERIFY_LIMIT   = 10
const WINDOW_SECONDS = 15 * 60

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)
  const { data, error } = await supa.auth.mfa.listFactors()
  if (error) return authJson({ error: 'mfa_unavailable' }, 500)
  const factors = (data?.totp ?? []).map((f) => ({ id: f.id, friendly_name: f.friendly_name ?? null }))
  return authJson({ factors })
}

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/mfa')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)

  const body = await readJson(req)
  const factorId = typeof body?.factorId === 'string' ? body.factorId : ''
  const code = normalizeTotp(body?.code)
  if (!factorId || !code) return authJson({ error: 'bad_code' }, 400)

  if (!(await rateLimitAllows(createSupabaseService(), `mfa-verify:user:${user.id}`, VERIFY_LIMIT, WINDOW_SECONDS))) {
    return authJson({ error: 'too_many' }, 429)
  }
  const { error } = await supa.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    logSecurityEvent({ kind: 'auth.mfa_failed', actor: user.id, ip: clientIp(req), path: '/api/auth/mfa' })
    return authJson({ error: 'bad_code' }, 400)
  }
  return authJson({ ok: true })
}
