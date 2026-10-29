import { describe, expect, it, vi } from 'vitest'
import { allowedRedirectHost, sanitizeRedirectUris, syncGvmsOidcClient, GVMS_CALLBACK_PATH } from './gvms-oidc'

describe('戻り先の検査', () => {
  it('コールバックのパスの https (と http のループバック) だけを、重複を除いて並べて残す', () => {
    expect(sanitizeRedirectUris([
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'http://localhost:8080/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'https://evil.example/other',
      'https://u:p@x.example/api/v1/auth/oidc/callback',
      'https://x.example/api/v1/auth/oidc/callback?a=1',
      'javascript:alert(1)',
      42,
    ])).toEqual([
      'http://localhost:8080/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
    ])
    expect(sanitizeRedirectUris('x')).toEqual([])
  })
  it('ループバック以外の http は捨てる (Supabase が受けず、一覧全体の登録が止まるため・.200 の実例)', () => {
    expect(sanitizeRedirectUris([
      'http://192.168.0.200:8080/api/v1/auth/oidc/callback',
      'https://10.9.0.1:8443/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'https://site200.sites.genesis-edge.com:8443/api/v1/auth/oidc/callback',
      'http://nvms.local/api/v1/auth/oidc/callback',
      'http://127.0.0.1:8080/api/v1/auth/oidc/callback',
    ], 'site200.sites.genesis-edge.com')).toEqual([
      'http://127.0.0.1:8080/api/v1/auth/oidc/callback',
      'https://10.9.0.1:8443/api/v1/auth/oidc/callback',
      'https://192.168.0.200:8443/api/v1/auth/oidc/callback',
      'https://site200.sites.genesis-edge.com:8443/api/v1/auth/oidc/callback',
    ])
  })
  it('★戻り先のホストは LAN・拠点に割り当てた名前・社内の名前だけ (ASVS 10.4.1)', () => {
    const site = 'site200.sites.genesis-edge.com'
    for (const ok of ['localhost', '127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.0.200', '100.64.1.2',
      '[fd12:3456::1]', site, 'SITE200.sites.genesis-edge.com', 'nvms', 'nvms.local', 'vms.corp', 'gvms.home.arpa']) {
      expect(allowedRedirectHost(ok, site), ok).toBe(true)
    }
    for (const ng of ['evil.example', 'site201.sites.genesis-edge.com', '8.8.8.8', '172.32.0.1', '[2001:db8::1]',
      'gvms-cloud.com', 'local.evil.example']) {
      expect(allowedRedirectHost(ng, site), ng).toBe(false)
    }
    expect(allowedRedirectHost(site, null)).toBe(false)  // 割り当てが無ければ公の名前は受けない
  })
  it('★外部のホストを混ぜた申告は、そのホストだけ捨てる', () => {
    expect(sanitizeRedirectUris([
      `https://192.168.0.200:8443${GVMS_CALLBACK_PATH}`,
      `https://evil.example${GVMS_CALLBACK_PATH}`,
    ], null)).toEqual([`https://192.168.0.200:8443${GVMS_CALLBACK_PATH}`])
  })
  it('10 件まで', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://10.0.0.${i}${GVMS_CALLBACK_PATH}`)
    expect(sanitizeRedirectUris(many)).toHaveLength(10)
  })
})

/** gvms_oidc_clients と recorders と auth.admin.oauth だけを持つ偽のサービスクライアント。 */
type Row = { client_id: string; redirect_uris: string[]; code_grant_only?: boolean }
function fakeSvc(row: Row | null) {
  const state = { row, version: 3, calls: [] as string[], grants: [] as string[][] }
  const oauth = {
    createClient: vi.fn(async (p: { redirect_uris: string[]; token_endpoint_auth_method: string; grant_types: string[] }) => {
      state.calls.push(`create:${p.token_endpoint_auth_method}`)
      state.grants.push(p.grant_types)
      return { data: { client_id: 'cid-new' }, error: null }
    }),
    updateClient: vi.fn(async (_id: string, p: { grant_types?: string[] }) => {
      state.calls.push(p.grant_types ? 'grant' : 'update')
      if (p.grant_types) state.grants.push(p.grant_types)
      return { data: {}, error: null }
    }),
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
      insert: (v: Row) => { state.row = v; return Promise.resolve({ error: null }) },
      delete: () => { state.row = null; return { eq: async () => ({ error: null }) } },
      update: (v: { config_version?: number; redirect_uris?: string[]; code_grant_only?: boolean }) => {
        if (name === 'recorders' && v.config_version) state.version = v.config_version
        if (name === 'gvms_oidc_clients' && state.row && v.redirect_uris) state.row = { ...state.row, redirect_uris: v.redirect_uris }
        if (name === 'gvms_oidc_clients' && state.row && v.code_grant_only !== undefined) state.row = { ...state.row, code_grant_only: v.code_grant_only }
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
  it('★新しいクライアントは認可コードだけ (refresh_token を許さない・ASVS 10.1.1)', async () => {
    const { state, svc } = fakeSvc(null)
    await syncGvmsOidcClient(svc, 'e1', ['oidc'], [URI])
    expect(state.grants).toEqual([['authorization_code']])
    expect(state.row?.code_grant_only).toBe(true)
  })
  it('★以前に作ったクライアントは 1 度だけ認可コードだけへ直す', async () => {
    const { state, svc } = fakeSvc({ client_id: 'c1', redirect_uris: [URI], code_grant_only: false })
    expect(await syncGvmsOidcClient(svc, 'e1', ['oidc'], [URI])).toBe('updated')
    expect(state.calls).toEqual(['grant'])
    expect(state.grants).toEqual([['authorization_code']])
    expect(await syncGvmsOidcClient(svc, 'e1', ['oidc'], [URI])).toBe('unchanged')
    expect(state.calls).toEqual(['grant'])
  })
})
