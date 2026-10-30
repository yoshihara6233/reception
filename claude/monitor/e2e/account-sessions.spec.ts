/**
 * サインイン中の端末の画面 (/account/sessions・2026-10-31・ASVS 7.5.2)。
 *
 * 切る操作は、並んで走るほかの試験が同じ利用者のセッションを使うので、ここではしない
 * (DB の関数の動きは手元の DB で確かめた・本人の分だけ・今の端末は 1 つ切りでは切れない)。
 */
import { expect, test } from '@playwright/test'
import { storageStatePath } from './personas'

test.describe('ログインしている利用者', () => {
  test.use({ storageState: storageStatePath('viewerA1') })

  test('自分の端末の一覧が出て、今の端末に印が付き、今の端末には「切る」が出ない', async ({ page }) => {
    await page.goto('/account/sessions')
    await expect(page.getByRole('heading', { name: 'サインイン中の端末' })).toBeVisible()
    const current = page.locator('li', { hasText: 'この端末' })
    await expect(current).toHaveCount(1)
    await expect(current.getByRole('button', { name: '切る' })).toHaveCount(0)
  })
})

test.describe('ログインしていない利用者', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('サインインの画面へ戻る', async ({ page }) => {
    await page.goto('/account/sessions')
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fsessions/)
  })
})
