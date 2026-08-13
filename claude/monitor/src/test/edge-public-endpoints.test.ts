import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * エッジが叩く 2 本の受け口（`/api/edge/enroll` と `/api/edge/bootstrap`）の硬化。
 *
 * どちらもログイン不要（トークンだけで到達する）ので、
 *   ・**内部の失敗理由を外へ出さない** — 列名やスキーマ状態が漏れる
 *   ・**本文を読む前に回数で絞る**     — 公開受け口を DB 負荷に使わせない
 * の 2 点を固定する。
 */

const h = vi.hoisted(() => ({
  /** rate_limit_hit の戻り値。false = 上限超過 */
  rateOk:   true,
  rpcCalls: [] as { key: string; limit: number }[],
  /** enroll が本文処理（DB 参照）へ進んだか */
  tableHits: [] as string[],
  /** bootstrap の edge_devices 参照が返すエラー */
  lookupErr: null as { message: string } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ key: args.p_key as string, limit: args.p_limit as number })
      return { data: h.rateOk, error: null }
    },
    from: (table: string) => {
      h.tableHits.push(table)
      const row = {
        select: () => row, eq: () => row, is: () => row, gt: () => row,
        insert: () => row, update: () => row,
        single:     async () => ({ data: null, error: h.lookupErr }),
        maybeSingle: async () => ({ data: null, error: h.lookupErr }),
      }
      return row
    },
  }),
}))

vi.mock('@/lib/edge/auth-provision', () => ({
  edgeAuthEmail: (id: string) => `edge+${id}@example.invalid`,
  ensureEdgeAuthPassword: async () => null,
  mayWithholdServiceRole: () => false,
}))

beforeEach(() => {
  h.rateOk = true
  h.rpcCalls = []
  h.tableHits = []
  h.lookupErr = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-value'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('/api/edge/enroll の回数制限', () => {
  const post = async (ip?: string) => {
    const { POST } = await import('@/app/api/edge/enroll/route')
    const { NextRequest } = await import('next/server')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (ip) headers['x-forwarded-for'] = ip
    return POST(new NextRequest('http://localhost/api/edge/enroll', {
      method: 'POST', headers, body: JSON.stringify({ token: 'x'.repeat(64) }),
    }))
  }

  it('IP 単位で数える', async () => {
    await post('203.0.113.9')
    expect(h.rpcCalls[0]).toEqual({ key: 'enroll:ip:203.0.113.9', limit: 30 })
  })

  it('★上限超過は 429、しかも DB を引かない（本文を読む前に落ちる）', async () => {
    h.rateOk = false
    const res = await post('203.0.113.9')
    expect(res.status).toBe(429)
    // 公開受け口を DB 負荷に使わせないのが目的なので、
    // 「弾いた」だけでなく「引かせていない」ことを見る。
    expect(h.tableHits).toEqual([])
  })

  it('上限内なら本文処理へ進む', async () => {
    const res = await post('203.0.113.9')
    expect(res.status).not.toBe(429)
    expect(h.tableHits).toContain('enrollment_tokens')
  })

  it('IP が取れなければ制限を掛けない（登録作業を止めない）', async () => {
    await post()
    expect(h.rpcCalls).toEqual([])
    expect(h.tableHits).toContain('enrollment_tokens')
  })
})

describe('/api/edge/bootstrap のエラー応答', () => {
  const get = async (token?: string) => {
    const { GET } = await import('@/app/api/edge/bootstrap/route')
    const { NextRequest } = await import('next/server')
    const headers: Record<string, string> = {}
    if (token) headers['x-device-token'] = token
    return GET(new NextRequest('http://localhost/api/edge/bootstrap', { headers }))
  }

  it('★DB エラーの内容を返さない（列名・スキーマ状態が漏れる）', async () => {
    h.lookupErr = { message: 'column edge_devices.scoped_only does not exist' }
    const res = await get('dev-token')
    const body = JSON.stringify(await res.json())

    expect(res.status).toBe(500)
    expect(body).not.toContain('scoped_only')
    expect(body).not.toContain('column')
    expect(body).not.toContain('detail')
  })

  it('サーバ側の失敗(500)とトークン不正(401)は分けたまま', async () => {
    // 2026-08-06、migration 未適用で全エッジの bootstrap が落ちた際、
    // スキーマエラーが 401 に化けて切り分けに時間を要した。ここは戻さない。
    h.lookupErr = { message: 'schema cache miss' }
    expect((await get('dev-token')).status).toBe(500)

    h.lookupErr = null
    expect((await get('dev-token')).status).toBe(401)   // data なし = トークン不一致
  })

  it('トークンが無ければ 401', async () => {
    expect((await get()).status).toBe(401)
  })

  it('★service_role 鍵がエラー応答に混ざらない', async () => {
    h.lookupErr = { message: 'boom' }
    const res = await get('dev-token')
    expect(JSON.stringify(await res.json())).not.toContain('service-role-key-value')
  })
})
