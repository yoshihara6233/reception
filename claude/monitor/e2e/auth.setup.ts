/**
 * 6 ロール分ログインして、以降のテストが使い回す storageState を作る。
 *
 * これ自体が「全ロールがログインできる」ことのテストを兼ねている。
 * 2026-08-09 に baggage_manager が DB の CHECK 制約から漏れていて、
 * **本番でそのロールのユーザを作れなかった**（作成すると 500）。
 * ここで 1 人でも落ちれば、その種の欠落は次からログイン以前に分かる。
 */
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'
import { ALL_PERSONAS, PASSWORD, storageStatePath } from './personas'

setup.describe.configure({ mode: 'parallel' })

/** 認証アプリの 6 桁の番号 (RFC 6238・30 秒・SHA-1)。secret は base32。 */
function totp(secret: string, atMs = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const off = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** 多要素が必須の役割 (lib/auth/mfa.ts の MFA_REQUIRED_ROLES) */
const MFA_ROLES = ['super_admin', 'tenant_admin']

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
    const mustEnroll = MFA_ROLES.includes(p.role)
    await expect
      .poll(async () => (await error.isVisible()) ? await error.innerText() : page.url(),
            { message: `${p.email} のログインが完了しません`, timeout: 30_000 })
      .toContain(mustEnroll ? '/account/security' : p.landing)

    if (mustEnroll) {
      // 管理者は多要素の登録が必須。受け口で登録し、番号を確かめて aal2 にしてから進む
      const started = await page.evaluate(async () => {
        const r = await fetch('/api/account/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        return { status: r.status, body: await r.json() }
      })
      expect(started.status, JSON.stringify(started.body)).toBe(200)
      const verified = await page.evaluate(async ({ factorId, code }) => {
        const r = await fetch('/api/account/mfa/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ factorId, code }),
        })
        return r.status
      }, { factorId: String(started.body.id), code: totp(String(started.body.secret)) })
      expect(verified).toBe(200)
      await page.goto(p.landing)
    }

    // baggage_manager だけは /stores へ push された直後に middleware が
    // /baggage へ差し戻す。着地はペルソナ定義に持たせてある。
    await expect(page).toHaveURL(new RegExp(`${p.landing}(\\?|$)`))

    await page.context().storageState({ path: storageStatePath(p.key) })
  })
}
