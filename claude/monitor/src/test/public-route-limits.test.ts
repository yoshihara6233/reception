import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 無認証で叩ける受け口の濫用対策を、ハンドラを実際に呼んで確かめる。
 *
 * ガード棚卸し（PR #282）で無認証は 3 本と確定した。そのうち
 *   /api/geocode         : 呼び出し元が認証必須ページだけ ＝ 公開する理由が無い
 *                          → ログイン必須にして経路ごと閉じた（許可リストから除外）
 *   /api/auth/reset-link : 認証の入口そのものなので閉じられない
 *                          → 回数で縛る（メール 3回/時・IP 10回/時）
 *   /api/server-time     : 時刻のみ。対策不要
 *
 * 「上限を超えたらメールを送らない」が守りたい性質そのものなので、
 * ステータスコードではなく **sendEmail が呼ばれないこと** を見る。
 */

const h = vi.hoisted(() => ({
  loggedIn: false,
  /** rate_limit_hit の戻り値。false = 上限超過 */
  rateOk: true,
  rpcCalls: [] as { key: string; limit: number }[],
  emailsSent: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.loggedIn ? { id: 'u1' } : null }, error: null }) },
  }),
  createSupabaseService: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ key: args.p_key as string, limit: args.p_limit as number })
      return { data: h.rateOk, error: null }
    },
    auth: {
      admin: {
        generateLink: async () => ({
          data: { properties: { email_otp: 'otp-123' } },
          error: null,
        }),
      },
    },
  }),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: async () => { h.emailsSent += 1 },
  passwordResetEmail: () => ({ subject: 's', html: '<p>h</p>' }),
  SECURITY_FROM_ADDRESS: 'security@example.com',
}))

beforeEach(() => {
  h.loggedIn = false
  h.rateOk = true
  h.rpcCalls = []
  h.emailsSent = 0
})

describe('/api/geocode はログイン必須（無認証の踏み台にしない）', () => {
  it('未ログインは 401', async () => {
    const { GET } = await import('@/app/api/geocode/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/geocode?zipcode=1600022'))
    expect(res.status).toBe(401)
  })

  it('未ログインでは外部 API を叩く前に落ちる（郵便番号の検証にも進まない）', async () => {
    // 401 が先。不正な郵便番号でも 400 ではなく 401 になる＝認証が最初の関門。
    const { GET } = await import('@/app/api/geocode/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/geocode?zipcode=abc'))
    expect(res.status).toBe(401)
  })
})

describe('/api/auth/reset-link の回数制限', () => {
  const post = async (email: string, ip?: string) => {
    const { POST } = await import('@/app/api/auth/reset-link/route')
    const { NextRequest } = await import('next/server')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (ip) headers['x-forwarded-for'] = ip
    return POST(new NextRequest('http://localhost/api/auth/reset-link', {
      method: 'POST', headers, body: JSON.stringify({ email }),
    }))
  }

  it('上限内ならメールを送る', async () => {
    h.rateOk = true
    const res = await post('user@example.com', '203.0.113.9')
    expect(res.status).toBe(200)
    expect(h.emailsSent).toBe(1)
  })

  it('上限超過ではメールを送らない', async () => {
    h.rateOk = false
    const res = await post('victim@example.com', '203.0.113.9')
    expect(h.emailsSent).toBe(0)
    // 429 ではなく 200 generic。弾いたことを教えると宛先の実在を推測できるため。
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('メール単位と IP 単位の両方で数える', async () => {
    await post('user@example.com', '203.0.113.9')
    expect(h.rpcCalls.map((c) => c.key)).toEqual([
      'reset-link:email:user@example.com',
      'reset-link:ip:203.0.113.9',
    ])
    expect(h.rpcCalls.map((c) => c.limit)).toEqual([3, 10])
  })

  it('メールアドレスは小文字に揃えて数える（大文字で上限を回避させない）', async () => {
    await post('User@Example.COM', '203.0.113.9')
    expect(h.rpcCalls[0].key).toBe('reset-link:email:user@example.com')
  })

  it('IP が取れなければメール単位だけで数える', async () => {
    await post('user@example.com')
    expect(h.rpcCalls.map((c) => c.key)).toEqual(['reset-link:email:user@example.com'])
    expect(h.emailsSent).toBe(1)
  })
})
