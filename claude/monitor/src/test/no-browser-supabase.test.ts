import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options'

/**
 * セッションの Cookie を HttpOnly に保つための見張り (2026-10-29・ASVS 3.3.4)。
 *
 * ブラウザの Supabase クライアント (createBrowserClient) は、セッションを JavaScript から読める
 * Cookie に置く。1 か所でも戻すと、そこでログインした人のトークンは画面の XSS で持ち出せる。
 * ログインまわりはサーバの受け口 (/api/auth/*・/api/account/mfa) で行うこと。
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

describe('ブラウザの Supabase クライアントを使わない', () => {
  it('createBrowserClient を呼ぶソースが無い', () => {
    const hits = walk(SRC).filter((f) => /createBrowserClient\s*\(/.test(readFileSync(f, 'utf8')))
    expect(hits.map((f) => f.slice(SRC.length))).toEqual([])
  })

  it('セッションの Cookie は HttpOnly・SameSite=Lax', () => {
    expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true)
    expect(SESSION_COOKIE_OPTIONS.sameSite).toBe('lax')
  })
})
