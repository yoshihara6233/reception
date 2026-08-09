/**
 * ロール別の画面境界。**「メニューに出ていない」だけでは不十分**で、
 * 直 URL でも到達できないことを毎回セットで確かめる。
 * 2026-07-23 に、メニューからは消えているのに直 URL では開けるページがあった。
 *
 * 見るのは「見える / 見えない」「到達できる / できない」だけに絞る。
 * 見た目（色・位置・ピクセル）は対象外——壊れやすく、壊れても誰も直さないため。
 */
import { expect, test, type Page } from '@playwright/test'
import { PERSONAS, STORE_A1, STORE_A2, STORE_B1, storageStatePath } from './personas'

/** 権限不足のページに出る文言（AdminDenied）。 */
const DENIED = 'アクセス権限がありません'
/**
 * 拒否の表現は現状 3 通りある:
 *   「アクセス権限がありません」……… AdminDenied（多数派）
 *   「…権限がありません。」…………… /admin/baggage の独自表示
 *   Next の 404 ………………………… notFound() を使うページ
 * 入れていないことに変わりはないので、判定はこの 3 つを許す。
 * **揃えるかどうかは UI の判断**なので、テストの都合で一方へ寄せない。
 */
const DENIED_ANY = /権限がありません/
/** super_admin が操作中テナント未選択のときのゲート（TenantGate）。 */
const TENANT_GATE = 'テナントを選択してください'

/** 左メニュー（②運営管理が出るのはここ）。上部のモジュールタブとは別物。 */
const sectionMenu = (page: Page) => page.getByRole('navigation', { name: 'セクションメニュー' })

/** 直 URL で開いて「拒否された」ことを確かめる。 */
async function expectDenied(page: Page, path: string) {
  await page.goto(path)
  const denied = page.getByText(DENIED_ANY)
  const notFound = page.getByText(/404|見つかりません|not be found/i)
  await expect
    .poll(async () => (await denied.count()) + (await notFound.count()),
          { message: `${path} に到達できてしまいました`, timeout: 15_000 })
    .toBeGreaterThan(0)
}

// ── システム管理者（super_admin）─────────────────────────────────────────
test.describe('システム管理者（super_admin）', () => {
  test.use({ storageState: storageStatePath('super') })

  test('操作中テナント未選択では店舗一覧がゲート表示になる', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(TENANT_GATE)).toBeVisible()
  })

  test('左メニューに②運営管理が出る', async ({ page }) => {
    await page.goto('/admin/reports/usage')
    const menu = sectionMenu(page)
    await expect(menu.getByText('運営管理')).toBeVisible()
    await expect(menu.getByRole('link', { name: /テナント/ })).toBeVisible()
    await expect(menu.getByRole('link', { name: /システム管理者/ })).toBeVisible()
  })

  test('②運営管理のページを開ける', async ({ page }) => {
    for (const path of ['/admin/edges', '/admin/ops-users', '/admin/tenants']) {
      await page.goto(path)
      await expect(page.getByText(DENIED), `${path} が super_admin に拒否されました`).toHaveCount(0)
    }
  })
})

// ── テナント管理者A（tenant_admin）───────────────────────────────────────
test.describe('テナントA 管理者（tenant_admin）', () => {
  test.use({ storageState: storageStatePath('adminA') })

  test('自テナントの店舗だけが見える', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(STORE_A1).first()).toBeVisible()
    await expect(page.getByText(STORE_A2).first()).toBeVisible()
    await expect(page.getByText(STORE_B1), '他テナントの店舗が見えています').toHaveCount(0)
  })

  test('左メニューに②運営管理が出ない', async ({ page }) => {
    await page.goto('/admin/reports/usage')
    const menu = sectionMenu(page)
    // ①設定は使えること（メニューごと消えているのではない、を同時に確かめる）
    await expect(menu.getByRole('link', { name: /店舗|Stores/ })).toBeVisible()
    await expect(menu.getByText('運営管理')).toHaveCount(0)
    await expect(menu.getByRole('link', { name: /システム管理者/ })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: /死活監視/ })).toHaveCount(0)
  })

  test('②運営管理のページに直 URL でも到達できない', async ({ page }) => {
    // メニューから消えているだけでは意味がない。ここが本番。
    await expectDenied(page, '/admin/edges')
    await expectDenied(page, '/admin/ops-users')
    await expectDenied(page, '/admin/tenants')
    await expectDenied(page, '/admin/limits')
    await expectDenied(page, '/admin/nvr-models')
    await expectDenied(page, '/admin/ops-audit')
  })
})

// ── テナント管理者B（漏れの相手役）──────────────────────────────────────
test.describe('テナントB 管理者（tenant_admin）', () => {
  test.use({ storageState: storageStatePath('adminB') })

  test('テナントAの店舗が一切見えない', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(STORE_B1).first()).toBeVisible()
    await expect(page.getByText(STORE_A1)).toHaveCount(0)
    await expect(page.getByText(STORE_A2)).toHaveCount(0)
  })
})

// ── 店長（store_manager）────────────────────────────────────────────────
test.describe('A1 店長（store_manager）', () => {
  test.use({ storageState: storageStatePath('storeA1') })

  test('担当店舗だけが見える（同じテナントの別店舗も見えない）', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(STORE_A1).first()).toBeVisible()
    await expect(page.getByText(STORE_A2), '担当外の店舗が見えています').toHaveCount(0)
    await expect(page.getByText(STORE_B1)).toHaveCount(0)
  })

  test('②運営管理には到達できない', async ({ page }) => {
    await expectDenied(page, '/admin/edges')
    await expectDenied(page, '/admin/ops-users')
  })
})

// ── 閲覧者（viewer）─────────────────────────────────────────────────────
test.describe('A1 閲覧者（viewer）', () => {
  test.use({ storageState: storageStatePath('viewerA1') })

  test('担当店舗は見える', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(STORE_A1).first()).toBeVisible()
    await expect(page.getByText(STORE_A2)).toHaveCount(0)
  })

  test('①設定（マスタ保守）の画面には入れない', async ({ page }) => {
    // viewer は ADMIN_ROLES（super_admin / tenant_admin / store_manager）に
    // 含まれない。閲覧だけのロールが設定を触れないことを画面で固定する。
    //
    // このうち stores / import / bcp / audit / audit/changes / baggage は
    // 2026-08-09 まで**ロール判定が無く到達できていた**（書き込みは API と
    // RLS が拒むので「押してから断る」状態だった）。入口で断る形に揃えた。
    await expectDenied(page, '/admin/users')
    await expectDenied(page, '/admin/stores')
    await expectDenied(page, '/admin/import')
    await expectDenied(page, '/admin/bcp')
    await expectDenied(page, '/admin/audit')
    await expectDenied(page, '/admin/audit/changes')
    await expectDenied(page, '/admin/baggage')
  })

  test('②運営管理にも入れない', async ({ page }) => {
    await expectDenied(page, '/admin/edges')
    await expectDenied(page, '/admin/tenants')
  })

  test('利用状況レポートは読める（意図的な例外）', async ({ page }) => {
    // 閲覧専用ロールでも自分の担当範囲の利用状況は見える。
    // ここが一緒に閉まってしまう事故を防ぐため、開いている側も固定しておく。
    await page.goto('/admin/reports/usage')
    await expect(page.getByText(DENIED)).toHaveCount(0)
  })
})

// ── 手荷物検査店長（baggage_manager）────────────────────────────────────
test.describe('A2 検査店長（baggage_manager）', () => {
  test.use({ storageState: storageStatePath('baggageA2') })

  test('担当モジュール（検査）には入れる', async ({ page }) => {
    await page.goto('/baggage')
    await expect(page).toHaveURL(/\/baggage/)
    await expect(page.getByText(DENIED)).toHaveCount(0)
  })

  test('Service Worker が登録できる（iPad キオスクの PWA）', async ({ page }) => {
    // 遮断の網が広すぎて /sw-v2.js まで /baggage へリダイレクトされていた。
    // ブラウザは「リダイレクトの先にある SW」を拒むので登録が失敗し、
    // **このロールだけオフラインが効かない**状態だった（2026-08-09）。
    const res = await page.request.get('/sw-v2.js', { maxRedirects: 0 })
    expect(res.status(), 'SW がリダイレクトされています').toBe(200)
  })

  test.describe('それ以外は middleware が /baggage へ差し戻す', () => {
    // ライブ視聴の時間を増やさないための中央強制。1 本でも漏れると
    // 「検査担当なのに全店のカメラが見える」になる。
    for (const path of ['/stores', '/admin', '/bcp', '/alarms', '/security/reports', '/infra']) {
      test(`${path} → /baggage`, async ({ page }) => {
        await page.goto(path)
        await expect(page).toHaveURL(/\/baggage$/)
      })
    }
  })
})

// ── 未ログイン ──────────────────────────────────────────────────────────
test.describe('未ログイン', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/stores', '/admin/users', '/admin/edges', '/baggage']) {
    test(`${path} はログイン画面へ`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }
})
