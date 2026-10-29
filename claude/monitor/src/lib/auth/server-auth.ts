import 'server-only'
/**
 * ログインまわりの受け口 (/api/auth/*・/api/account/mfa) の共通の部品 (2026-10-29・ASVS 3.3.4)。
 *
 * セッションの Cookie を HttpOnly にしたので、ログイン・多要素・再設定・ログアウトはすべてサーバで
 * 行う (lib/supabase/cookie-options.ts)。応答は保存させない (no-store)。
 */
import { NextResponse } from 'next/server'
import { isSameOriginJson } from '@/lib/security/same-origin'
import { logSecurityEvent, requestIp } from '@/lib/security/events'

/** 保存させない JSON の応答。 */
export function authJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** 別のサイトからの要求なら 403 の応答を返す (通すときは null)。 */
export function rejectCrossSite(req: Request, path: string): NextResponse | null {
  if (isSameOriginJson(req)) return null
  logSecurityEvent({ kind: 'auth.cross_site', ip: requestIp(req.headers), path })
  return authJson({ error: 'cross_site' }, 403)
}

/** 本文の JSON を読む。読めなければ null。 */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 認証アプリの番号 (6 桁) を整える。形が違えば null。 */
export function normalizeTotp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const c = v.replace(/\s/g, '')
  return /^\d{6}$/.test(c) ? c : null
}
