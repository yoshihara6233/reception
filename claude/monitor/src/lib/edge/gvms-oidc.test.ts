import { describe, expect, it, vi } from 'vitest'
import { sanitizeRedirectUris, syncGvmsOidcClient, GVMS_CALLBACK_PATH } from './gvms-oidc'

describe('戻り先の検査', () => {
  it('コールバックのパスの http(s) だけを、重複を除いて並べて残す', () => {
    expect(sanitizeRedirectUris([
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'http://nvms.local/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'https://evil.example/other',
      'https://u:p@x.example/api/v1/auth/oidc/callback',
      'https://x.example/api/v1/auth/oidc/callback?a=1',
      'javascript:alert(1)',
      42,
    ])).toEqual([
      'http://nvms.local/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
    ])
    expect(sanitizeRedirectUris('x')).toEqual([])
  })
  it('10 件まで', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://10.0.0.${i}${GVMS_CALLBACK_PATH}`)
    expect(sanitizeRedirectUris(many)).toHaveLength(10)
  })
})

/** gvms_oidc_clients と recorders と auth.admin.oauth だけを持つ偽のサービスクライアント。 */
function fakeSvc(row: { client_id: string; redirect_uris: string[] } | null) {
  const state = { row, version: 3, calls: [] as string[] }
  const oauth = {
    createClient: vi.fn(async (p: { redirect_uris: string[]; token_endpoint_auth_method: string }) => {
      state.calls.push(`create:${p.token_endpoint_auth_method}`)
      return { data: { client_id: 'cid-new' }, error: null }
    }),
    updateClient: vi.fn(async () => { state.calls.push('update'); return { data: {}, error: null } }),
    deleteClient: vi.fn(async () => { state.calls.push('delete'); return { data: null, error: null } }),
  }
  const table = (name: string) => {
    const q: Record<string, unknown> = {}
    const chain = () => q
    Object.assign(q, {
      select: chain, eq: chain, order: chain, limit: chain,
      maybeSingle: async () => name === 'gvms_oidc_clients'
        ? { data: state.row, error: null }
        : { data: { id: 'rec1', config_version: state.version }, error: null },
      insert: (v: { client_id: string; redirect_uris: string[] }) => { state.row = v; return Promise.resolve({ error: null }) },
      delete: () => { state.row = null; return { eq: async () => ({ error: null }) } },
      update: (v: { config_version?: number; redirect_uris?: string[] }) => {
        if (name === 'recorders' && v.config_version) state.version = v.config_version
        if (name === 'gvms_oidc_clients' && state.row && v.redirect_uris) state.row = { ...state.row, redirect_uris: v.redirect_uris }
        return { eq: async () => ({ error: null }) }
      },
    })
    return q
  }
  return { state, svc: { from: table, auth: { admin: { oauth } } } as never }
}

const URI = `https://192.168.0.200:8443${GVMS_CALLBACK_PATH}`

describe('拠点ごとの OAuth クライアント', () => {
  it('oidc を名乗った拠点に公開クライアントを作り、版を上げる', async () => {
    const { state, svc } = fakeSvc(null)
    expect(await syncGvmsOidcClient(svc, 'e1', ['grid', 'oidc'], [URI])).toBe('created')
    expect(state.calls).toEqual(['create:none'])
    expect(state.row?.client_id).toBe('cid-new')
    expect(state.version).toBe(4)
  })
  it('同じ申告なら何もしない。戻り先が変われば更新 (版は上げない)', async () => {
    const { state, svc } = fakeSvc({ client_id: 'c1', redirect_uris: [URI] })
    expect(await syncGvmsOidcClient(svc, 'e1', ['oidc'], [URI])).toBe('unchanged')
    const other = `https://nvms.local${GVMS_CALLBACK_PATH}`
    expect(await syncGvmsOidcClient(svc, 'e1', ['oidc'], [URI, other])).toBe('updated')
    expect(state.calls).toEqual(['update'])
    expect(state.version).toBe(3)
  })
  it('名乗りを外した拠点のクライアントは消し、版を上げる (配る設定から oidc が消える)', async () => {
    const { state, svc } = fakeSvc({ client_id: 'c1', redirect_uris: [URI] })
    expect(await syncGvmsOidcClient(svc, 'e1', ['grid'], undefined)).toBe('deleted')
    expect(state.calls).toEqual(['delete'])
    expect(state.row).toBeNull()
    expect(state.version).toBe(4)
  })
  it('名乗っていない拠点では Auth の API を呼ばない', async () => {
    const { state, svc } = fakeSvc(null)
    expect(await syncGvmsOidcClient(svc, 'e1', ['grid'], undefined)).toBe('unchanged')
    expect(state.calls).toEqual([])
  })
})
