/**
 * セッションの Cookie が JavaScript から読めないこと (2026-10-29・ASVS 3.3.4)。
 *
 * ログインはサーバの受け口 (/api/auth/login) で行い、Supabase のセッションを HttpOnly の Cookie に
 * 置く (lib/supabase/cookie-options.ts)。auth.setup.ts が画面からログインした状態を使い、
 * Cookie の属性と、画面の document.cookie にトークンが見えないことを確かめる。
 * サインアウトはその利用者のすべてのセッションを失効させ、並んで走るほかの試験を巻き込むので、ここではしない。
 */
import { expect, test } from '@playwright/test'
import { storageStatePath } from './personas'

test.use({ storageState: storageStatePath('viewerA1') })

test('ログインのセッションの Cookie は HttpOnly で、画面からは読めない', async ({ page, context }) => {
  await page.goto('/stores')
  const auth = (await context.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name))
  expect(auth.length, 'セッションの Cookie がありません').toBeGreaterThan(0)
  for (const c of auth) {
    expect(c.httpOnly, `${c.name} が HttpOnly ではありません`).toBe(true)
    expect(c.sameSite).toBe('Lax')
  }
  const visible = await page.evaluate(() => document.cookie)
  expect(visible).not.toContain('auth-token')
})

test('別のサイトからのログインの要求は断る', async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
    data: JSON.stringify({ email: 'viewer-a1@local.dev', password: 'x' }),
  })
  expect(res.status()).toBe(403)
})
