/**
 * 管理者が作った利用者は、初回のログインで本人のパスワードに変えるまで使えない (2026-10-30・ASVS 6.4.1)。
 *
 * 運営 (super_admin) が利用者を作り (仮のパスワード)、その人が画面からログインすると
 * /login/password へ送られ、変えると使い始められる。最後に作った利用者を消す。
 *
 * 作るのは運営の利用者 (テナントを持たない)。seed のテナントの ID ('00000000-…-b1') は
 * 作成の受け口の UUID の検査 (zod) を通らないため、テナントの利用者はここでは作れない。
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { storageStatePath } from './personas'

test.use({ storageState: storageStatePath('super') })

test('仮のパスワードで入った人は、変えるまで画面を使えない', async ({ page, browser }) => {
  const email = `temp-${randomUUID().slice(0, 8)}@local.dev`
  const temp = `Temp-${randomUUID()}`
  const mine = `Mine-${randomUUID()}`

  const created = await page.request.post('/api/admin/users', {
    data: { email, password: temp, display_name: '仮パスワードの試験', role: 'super_admin', tenant_id: null, store_ids: [] },
  })
  expect(created.status(), await created.text()).toBe(200)
  const { id } = await created.json() as { id: string }

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const p = await ctx.newPage()
    await p.goto('/login')
    const form = p.locator('form')
    const submit = form.getByRole('button', { name: 'ログイン' })
    await expect(submit).toBeEnabled()
    await form.locator('input[type="email"]').fill(email)
    await form.locator('input[type="password"]').fill(temp)
    await submit.click()
    await expect(p).toHaveURL(/\/login\/password$/)

    // ほかの画面へ行こうとしても戻される・API は 403
    await p.goto('/stores')
    await expect(p).toHaveURL(/\/login\/password$/)
    const api = await p.request.get('/api/admin/users')
    expect(api.status()).toBe(403)
    expect(await api.json()).toEqual({ error: 'password_change_required' })

    // 仮のパスワードと同じものは断る
    await p.locator('#new-password').fill(temp)
    await p.locator('#confirm-password').fill(temp)
    await p.getByRole('button', { name: '変更して始める' }).click()
    await expect(p.locator('.bg-red-50')).toContainText('同じパスワード')

    await p.locator('#new-password').fill(mine)
    await p.locator('#confirm-password').fill(mine)
    await p.getByRole('button', { name: '変更して始める' }).click()
    await expect(p).not.toHaveURL(/\/login/)
    // この利用者は super_admin なので、次は多要素の登録の画面へ進む (2026-10-31 から必須)
    await p.goto('/stores')
    await expect(p).toHaveURL(/\/account\/security\?required=1/)
  } finally {
    await ctx.close()
    await page.request.delete(`/api/admin/users/${id}`)
  }
})
