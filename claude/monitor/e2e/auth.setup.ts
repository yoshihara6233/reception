/**
 * 6 ロール分ログインして、以降のテストが使い回す storageState を作る。
 *
 * これ自体が「全ロールがログインできる」ことのテストを兼ねている。
 * 2026-08-09 に baggage_manager が DB の CHECK 制約から漏れていて、
 * **本番でそのロールのユーザを作れなかった**（作成すると 500）。
 * ここで 1 人でも落ちれば、その種の欠落は次からログイン以前に分かる。
 */
import { mkdirSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'
import { ALL_PERSONAS, PASSWORD, storageStatePath } from './personas'

setup.describe.configure({ mode: 'parallel' })

for (const p of ALL_PERSONAS) {
  setup(`ログインできる: ${p.label}（${p.role}）`, async ({ page }) => {
    mkdirSync('e2e/.auth', { recursive: true })

    await page.goto('/login')

    const form = page.locator('form')

    // **入力より先に**ハイドレーションを待つ。入力欄は controlled component
    // なので、ハイドレーション前に打ち込んだ値は React の初期 state（空文字）で
    // 上書きされて消える。消えたまま送信すると required 属性に止められ、
    // 「エラーも出ないし遷移もしない」という読み取りづらい失敗になる。
    // 送信ボタンは ready まで disabled なので、これが合図として使える。
    const submit = form.getByRole('button', { name: 'ログイン' })
    await expect(submit, 'ログインフォームがハイドレーションされません').toBeEnabled()

    // label は for/id で input と結び付いていないため種別で引く。
    // ここが壊れたら結び付けを直すほうが本筋（a11y の改善）。
    await form.locator('input[type="email"]').fill(p.email)
    await form.locator('input[type="password"]').fill(PASSWORD)
    await submit.click()

    // 認証失敗はフォーム内に赤いメッセージで出る。URL 待ちのタイムアウトで
    // 「何かが遅い」と誤読しないよう、失敗そのものを先に検出して読める形で落とす。
    const error = form.locator('.bg-red-50')
    await expect
      .poll(async () => (await error.isVisible()) ? await error.innerText() : page.url(),
            { message: `${p.email} のログインが完了しません`, timeout: 30_000 })
      .toContain(p.landing)

    // baggage_manager だけは /stores へ push された直後に middleware が
    // /baggage へ差し戻す。着地はペルソナ定義に持たせてある。
    await expect(page).toHaveURL(new RegExp(`${p.landing}(\\?|$)`))

    await page.context().storageState({ path: storageStatePath(p.key) })
  })
}
