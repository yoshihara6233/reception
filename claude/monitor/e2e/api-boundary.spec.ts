/**
 * API の境界を、**実際に動いているサーバへ投げて**確かめる。
 *
 * 単体テストはハンドラを直接呼ぶので、middleware・cookie・Next のルーティングを
 * 通らない。2026-08-09 に本番で無認証だった webhook は、コードを読むだけでは
 * 気づけず、実物を叩いて分かった。ここはその「実物を叩く」層。
 *
 * ここに置くのは、その日に塞いだ穴の回帰だけに絞る。網羅は
 * src/test/api-guard-inventory.test.ts（89 ルートの棚卸し）の担当。
 */
import { expect, test } from '@playwright/test'
import { storageStatePath } from './personas'

/** seed.example.sql の A1 店舗。実在する UUID でないと 404 と区別が付かない。 */
const STORE_A1_ID = '00000000-0000-0000-0000-0000000000c1'

test.describe('未ログイン', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('ジオコーディングは 401（外部APIの踏み台にさせない）', async ({ request }) => {
    const res = await request.get('/api/geocode?zipcode=1000001')
    expect(res.status()).toBe(401)
  })

  test('BCP テスト発令は 401', async ({ request }) => {
    const res = await request.post('/api/bcp/test', { data: {} })
    expect(res.status()).toBe(401)
  })

  test('ONVIF webhook はシークレット未設定なら受け付けない（フェイルクローズ）', async ({ request }) => {
    // E2E ではあえて ONVIF_WEBHOOK_SECRET を渡していない（scripts/e2e-dev.sh）。
    // 旧実装はこの状態で **200 を返して発報を受け付けていた**。
    const res = await request.post(`/api/webhooks/onvif/${STORE_A1_ID}`, {
      data: { topic: 'tns1:VideoSource/MotionAlarm' },
    })
    expect(res.status(), '未設定の webhook が受け付けています').toBe(500)
  })

  test('ONVIF webhook の GET が認証状態を漏らさない', async ({ request }) => {
    const res = await request.get(`/api/webhooks/onvif/${STORE_A1_ID}`)
    const body = JSON.stringify(await res.json())
    // 旧実装は 'open (no secret set)' と自ら公開し、開いている口の場所を教えていた。
    expect(body).not.toMatch(/open|no secret/i)
  })
})

test.describe('閲覧者（viewer）', () => {
  test.use({ storageState: storageStatePath('viewerA1') })

  test('BCP テスト発令はロール不足で 403', async ({ request }) => {
    // 旧実装はログイン確認だけで、その先を service role で全テナント横断に
    // 回していた。viewer でも他テナントの店舗へテスト発令を作れた。
    const res = await request.post('/api/bcp/test', {
      data: { lat: 35.68, lng: 139.76, radiusKm: 10, alertType: 'earthquake' },
    })
    expect(res.status()).toBe(403)
  })
})

test.describe('手荷物検査店長（baggage_manager）', () => {
  test.use({ storageState: storageStatePath('baggageA2') })

  test('担当外の API は middleware が 403 で弾く', async ({ request }) => {
    const res = await request.get('/api/alarms/open-count')
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('forbidden_baggage_manager')
  })

  test('担当モジュールの API は通る', async ({ request }) => {
    // 境界が「全部 403」になっていないこと。閉めすぎの回帰も同時に見る。
    const res = await request.get('/api/server-time')
    expect(res.status()).toBe(200)
  })
})
