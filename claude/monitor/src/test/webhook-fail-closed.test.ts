import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * webhook 受け口が「secret 未設定なら誰でも通す」形に戻っていないことを、
 * **実際にハンドラを呼んで**確かめる。
 *
 * 2026-08-09 の実測: /api/webhooks/onvif/[storeId] は
 *   const expectedSecret = process.env.ONVIF_WEBHOOK_SECRET
 *   if (expectedSecret) { ...401... }        // ← 未設定なら認証ごとスキップ
 * となっており、本番は env 未設定だった（GET が自ら `auth: 'open (no secret set)'`
 * と公開していた）。店舗UUIDさえ分かれば誰でも monitor_incidents に open な
 * 障害を投入できた。
 *
 * 当初はソースの正規表現で検査したが、`if (!secret) { /* skip *\/ } else {` へ
 * 書き換えても素通りした。コードの「形」ではなく「挙動」を見る必要がある。
 * 認証は DB より手前で判定されるので、Supabase に触れずここまで到達できる。
 */

const ENV_KEYS = ['ONVIF_WEBHOOK_SECRET', 'BCP_WEBHOOK_SECRET'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('secret 未設定のときに webhook が開かない', () => {
  it('/api/webhooks/onvif/[storeId] は 500 で拒否する（旧実装は素通りしていた）', async () => {
    const { POST } = await import('@/app/api/webhooks/onvif/[storeId]/route')
    const res = await POST(
      new Request('http://localhost/api/webhooks/onvif/s1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'tns1:VideoSource/MotionAlarm' }),
      }),
      { params: Promise.resolve({ storeId: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(res.status).toBe(500)
    expect((await res.json()).message).toBe('server_misconfiguration')
  })

  it('/api/webhooks/onvif/[storeId] は誤った secret も拒否する', async () => {
    process.env.ONVIF_WEBHOOK_SECRET = 'right'
    const { POST } = await import('@/app/api/webhooks/onvif/[storeId]/route')
    const res = await POST(
      new Request('http://localhost/api/webhooks/onvif/s1', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
        body: JSON.stringify({ topic: 'tns1:VideoSource/MotionAlarm' }),
      }),
      { params: Promise.resolve({ storeId: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(res.status).toBe(401)
  })

  it('/api/webhooks/onvif/[storeId] の GET は認証の設定状態を漏らさない', async () => {
    // 旧 GET は未設定のとき 'open (no secret set)' と返し、開いている受け口の
    // 場所を教えていた。
    const { GET } = await import('@/app/api/webhooks/onvif/[storeId]/route')
    const res = await GET(
      new Request('http://localhost/api/webhooks/onvif/s1'),
      { params: Promise.resolve({ storeId: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(JSON.stringify(await res.json())).not.toMatch(/open|no secret/i)
  })

  it('/api/bcp-webhook は 500 で拒否する（元から正しい実装・回帰防止）', async () => {
    const { POST } = await import('@/app/api/bcp-webhook/route')
    const res = await POST(new Request('http://localhost/api/bcp-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'x' }),
    }) as never)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_misconfiguration')
  })
})
