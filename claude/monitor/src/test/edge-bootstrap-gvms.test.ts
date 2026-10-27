import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/edge/bootstrap` は G・VMS 本体の内蔵アップリンク (nvmsd) に service_role を返さない
 * (2026-10-28・自主診断で発見)。
 *
 * nvmsd の device_token は現場のサーバの /etc/nvms/uplink.env に置かれ、現場の管理者や
 * 販売店が読める。ここで鍵を返すと、1 拠点のトークンの漏れが全テナントの DB・置き場の
 * 読み書きになる。nvmsd 自身は bootstrap を使わない。
 * 試作のエッジ箱 (intereco-edge) は従来どおり受け取れること (止めると箱が動かない) も固定する。
 */

const h = vi.hoisted(() => ({
  edge: null as Record<string, unknown> | null,
  recorders: [] as { id: string }[],
  tokens: [] as { id: string }[],
  lookupErr: null as { message: string } | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, is: () => q, gt: () => q, update: () => q, delete: () => q,
        insert: (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return q },
        limit: async () => {
          if (h.lookupErr) return { data: null, error: h.lookupErr }
          return { data: table === 'recorders' ? h.recorders : table === 'enrollment_tokens' ? h.tokens : [], error: null }
        },
        single: async () => ({ data: table === 'edge_devices' ? { id: 'edge-new' } : null, error: null }),
        maybeSingle: async () => {
          if (table === 'edge_devices') return { data: h.edge, error: null }
          if (table === 'enrollment_tokens') {
            // enroll の事前検証 (1 回目) と原子的クレーム (2 回目) の両方に行を返す
            return { data: { id: 'tok-1', kind: 'nvms', store_id: 'store-1', name: 'G・VMS', camera_tier: 16 }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return q
    },
  }),
}))

vi.mock('@/lib/edge/auth-provision', async (orig) => ({
  ...(await orig<typeof import('@/lib/edge/auth-provision')>()),
  // スコープトークンは発行できなかった応答にする (= 従来の安全装置なら鍵を返してしまう条件)
  ensureEdgeAuthPassword: async () => null,
}))

const KEY = 'service-role-key-value'

beforeEach(() => {
  h.edge = { id: 'edge-1', store_id: 'store-1', scoped_only: false, auth_user_id: null, auth_password_enc: null,
    agent_version: null, desired_agent_version: null, desired_cloudflared_version: null }
  h.recorders = []
  h.tokens = []
  h.lookupErr = null
  h.inserts = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const bootstrap = async () => {
  const { GET } = await import('@/app/api/edge/bootstrap/route')
  const { NextRequest } = await import('next/server')
  const res = await GET(new NextRequest('http://localhost/api/edge/bootstrap', { headers: { 'x-device-token': 'dev-token' } }))
  return { status: res.status, text: JSON.stringify(await res.json()) }
}

describe('/api/edge/bootstrap は G・VMS の内蔵アップリンクに service_role を返さない', () => {
  it('★agent_version が nvmsd/ なら返さない', async () => {
    h.edge!.agent_version = 'nvmsd/0.1.203'
    const r = await bootstrap()
    expect(r.status).toBe(200)
    expect(r.text).not.toContain(KEY)
    expect(r.text).toContain('edge-1')
  })

  it('★最初の heartbeat の前でも、vendor=nvms のレコーダがあれば返さない', async () => {
    h.recorders = [{ id: 'rec-1' }]
    expect((await bootstrap()).text).not.toContain(KEY)
  })

  it('★レコーダの自動作成に失敗していても、kind=nvms のエンロールなら返さない', async () => {
    h.tokens = [{ id: 'tok-1' }]
    expect((await bootstrap()).text).not.toContain(KEY)
  })

  it('★scoped_only を外されていても返さない (列に頼らない)', async () => {
    h.edge!.agent_version = 'nvmsd/0.1.203'
    h.edge!.scoped_only = false
    expect((await bootstrap()).text).not.toContain(KEY)
  })

  it('試作のエッジ箱 (G・VMS でない) には従来どおり返す — 止めると箱が動かない', async () => {
    h.edge!.agent_version = 'intereco-edge/1.4.0'
    expect((await bootstrap()).text).toContain(KEY)
  })

  it('見分けの照会に失敗したら従来どおり (試作の箱を DB の一時的な失敗で止めない)', async () => {
    h.lookupErr = { message: 'timeout' }
    expect((await bootstrap()).text).toContain(KEY)
  })
})

describe('/api/edge/enroll は G・VMS を最初から scoped_only で登録する', () => {
  it('kind=nvms のエンロールで edge_devices に scoped_only=true を入れる', async () => {
    const { POST } = await import('@/app/api/edge/enroll/route')
    const { NextRequest } = await import('next/server')
    await POST(new NextRequest('http://localhost/api/edge/enroll', {
      method: 'POST', body: JSON.stringify({ token: 'a'.repeat(64) }),
      headers: { 'content-type': 'application/json' },
    }))
    const edgeInsert = h.inserts.find((i) => i.table === 'edge_devices')
    expect(edgeInsert?.row.scoped_only).toBe(true)
  })
})
