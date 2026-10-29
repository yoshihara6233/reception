/**
 * ロール別可視範囲の UI到達 smoke（G1・GA計画 テスト高価値3本の1つ）。
 *
 * authz 契約テスト（DB/RLS）は「クエリで何が見えるか」を検証するが、
 * admin_users 越権バグは UI 経路（ルーティング境界）でも再発し得る。
 * ここでは実物の middleware() に本物の NextRequest を通し、
 * 「どのロールがどの URL に到達できるか」の行列を CI で固定する。
 *
 * Supabase クライアントのみモック（auth.getUser と admin_users.role 参照）。
 * パス判定・リダイレクト・403・静的アセット素通しは実コードがそのまま走る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── @supabase/ssr モック（ロールとログイン状態をテスト側から注入） ──────────
const state: { user: { id: string } | null; role: string | null; token: string | null; suspended?: boolean } =
  { user: null, role: null, token: null }
const getUserMock = vi.fn(async () => ({ data: { user: state.user } }))
// access_token は cookie から読むだけの想定なので、往復カウントの対象外。
const getSessionMock = vi.fn(async () => ({
  data: { session: state.token ? { access_token: state.token } : null },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock, getSession: getSessionMock },
    rpc: async (name: string) => ({ data: name === 'auth_tenant_suspended' ? state.suspended === true : null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.role === null ? null : { role: state.role } }),
        }),
      }),
    }),
  }),
}))

import { middleware, resetMiddlewareRoleCache } from './middleware'

const req = (path: string) => new NextRequest(`https://monitor.test${path}`)

let tokenSeq = 0
function asRole(role: string | null) {
  state.user = role === null ? null : { id: 'u-1' }
  state.role = role
  // ロールを変えたら別トークン扱いにする（テスト間で判定を持ち越さないため）。
  state.token = `tok-${++tokenSeq}`
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  getUserMock.mockClear()
  getSessionMock.mockClear()
  resetMiddlewareRoleCache()
})

describe('baggage_manager（手荷物検査店長）— /baggage 系のみ到達可', () => {
  beforeEach(() => asRole('baggage_manager'))

  it.each([
    '/stores',
    '/stores/abc/cam/xyz/live',   // ライブ視聴（遮断の主目的）
    '/map',
    '/admin/users',
    '/alarms',
    '/security',
    '/bcp',
  ])('ページ %s → /baggage へリダイレクト', async (path) => {
    const res = await middleware(req(path))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/baggage')
  })

  it('リダイレクト時にクエリを引き継がない', async () => {
    const res = await middleware(req('/stores?foo=1&bar=2'))
    const loc = new URL(res.headers.get('location')!)
    expect(loc.search).toBe('')
  })

  it.each([
    '/api/vod',
    '/api/live-proxy/cam1/api/stream.m3u8',
    '/api/sessions',
    '/api/edges/e1/cam/c1/snapshot.png',   // /api/ は画像拡張子でも迂回させない
  ])('API %s → 403 forbidden_baggage_manager', async (path) => {
    const res = await middleware(req(path))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden_baggage_manager')
  })

  it.each([
    '/baggage',
    '/baggage/1234',
    '/baggage/ipad',
    '/kiosk/baggage/store-1',
    '/api/baggage/kiosk/sessions',
    '/api/auth/callback',
    '/api/server-time',
    '/login',
  ])('許可パス %s → 素通し（ロール参照なし）', async (path) => {
    const res = await middleware(req(path))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    // 許可パスでは認証・ロール参照を行わない（キオスク常用経路の最適化を固定）
    expect(getUserMock).not.toHaveBeenCalled()
  })
})

describe('通常ロール — 制限なく到達', () => {
  it.each([
    ['super_admin', '/admin/users'],
    ['tenant_admin', '/stores'],
    ['store_manager', '/stores/abc/cam/xyz/live'],
    ['store_manager', '/api/vod'],
    ['viewer', '/map'],
  ])('%s: %s → 素通し', async (role, path) => {
    asRole(role)
    const res = await middleware(req(path))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('未ログイン — middleware は遮断しない（各ページの getUser がログインへ誘導）', () => {
  it('/stores → 素通し', async () => {
    asRole(null)
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('静的アセット', () => {
  it('/icons/icon-192.png → 認証・ロール参照なしで素通し', async () => {
    asRole('baggage_manager')
    const res = await middleware(req('/icons/icon-192.png'))
    expect(res.status).toBe(200)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('拠点別キオスク manifest（/kiosk 配下 .webmanifest）→ 素通し', async () => {
    asRole('baggage_manager')
    const res = await middleware(req('/kiosk/baggage/store-1/manifest.webmanifest'))
    expect(res.status).toBe(200)
  })
})

describe('admin_users 行が無い認証済みユーザー（プロビジョニング不全）', () => {
  it('/stores → 素通し（baggage_manager ではないため制限対象外）', async () => {
    state.user = { id: 'u-orphan' }
    state.role = null
    state.token = 'tok-orphan'
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
  })
})

/**
 * ライブ画像は1〜2秒ごとにポーリングされ、その全てがこの境界を通る。
 * ここで毎回 getUser() を叩くと Auth への往復だけで1視聴者あたり毎時数千回になる
 * （2026-08 に API Gateway 23万 req/24h の主因と判明）。判定のメモ化を CI で固定する。
 */
describe('ロール判定のキャッシュ（Auth 往復の削減）', () => {
  it('★同じトークンの連続アクセスでは getUser を1回しか呼ばない', async () => {
    asRole('store_manager')
    for (let i = 0; i < 5; i++) {
      const res = await middleware(req('/api/edges/e1/grid'))
      expect(res.status).toBe(200)
    }
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('★判定はキャッシュ後も変わらない（baggage_manager は2回目以降も遮断）', async () => {
    asRole('baggage_manager')
    const first = await middleware(req('/api/edges/e1/grid'))
    const second = await middleware(req('/api/edges/e1/grid'))
    expect(first.status).toBe(403)
    expect(second.status).toBe(403)
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('★トークンが変われば再検証する（再ログイン・トークン更新後）', async () => {
    asRole('store_manager')
    await middleware(req('/stores'))
    state.token = 'tok-rotated'
    await middleware(req('/stores'))
    expect(getUserMock).toHaveBeenCalledTimes(2)
  })

  it('未ログイン（トークン無し）はキャッシュせず、毎回 getUser に落ちる', async () => {
    asRole(null)
    state.token = null
    await middleware(req('/stores'))
    await middleware(req('/stores'))
    expect(getUserMock).toHaveBeenCalledTimes(2)
  })
})

describe('旧 URL の転送（middleware を通して）', () => {
  const oldReq = (path: string) => new NextRequest(`https://intereco-monitor.vercel.app${path}`)

  it('画面は 307 で新 URL へ（ロールの参照より前）', async () => {
    getUserMock.mockClear()
    const res = await middleware(oldReq('/stores?x=1'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://gvms-cloud.com/stores?x=1')
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('API は転送しない', async () => {
    asRole(null)
    const res = await middleware(oldReq('/api/edge/heartbeat'))
    expect(res.headers.get('location')).toBeNull()
  })
})

/**
 * 多要素認証（2026-10-28）: 多要素を登録した人は、番号を確かめるまで（トークンが aal2 になるまで）
 * 非許可パスを使えない。判定はロールと同じ getUser から作り、往復を増やさない。
 */
describe('多要素の番号の確認が済んでいない人', () => {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const jwt = (aal: string) => `${b64({ alg: 'none' })}.${b64({ aal, n: ++tokenSeq })}.sig`
  function asMfaUser(aal: string) {
    asRole('store_manager')
    state.user = { id: 'u-1', factors: [{ status: 'verified' }] } as unknown as { id: string }
    state.token = jwt(aal)
  }

  it('画面は /login/mfa へ（元の画面を next に付ける）', async () => {
    asMfaUser('aal1')
    const res = await middleware(req('/stores?x=1'))
    expect(res.status).toBe(307)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/login/mfa')
    expect(loc.searchParams.get('next')).toBe('/stores?x=1')
  })

  it('API は 401', async () => {
    asMfaUser('aal1')
    const res = await middleware(req('/api/vod'))
    expect(res.status).toBe(401)
  })

  it('拠点の SSO の同意の画面も止める（番号を確かめてから拠点のトークンを出す）', async () => {
    asMfaUser('aal1')
    const res = await middleware(req('/oauth/consent?authorization_id=abc'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login/mfa')
  })

  it('aal2 になれば通す', async () => {
    asMfaUser('aal2')
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('ログインと番号の画面は止めない（許可パス）', async () => {
    asMfaUser('aal1')
    for (const p of ['/login', '/login/mfa', '/api/auth/callback']) {
      const res = await middleware(req(p))
      expect(res.headers.get('location')).toBeNull()
    }
  })

  it('★判定はキャッシュされ、getUser は 1 回だけ', async () => {
    asMfaUser('aal1')
    await middleware(req('/api/edges/e1/grid'))
    await middleware(req('/api/edges/e1/grid'))
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * 拠点 (G・VMS) 向けに出したトークン（client_id 付き）は、クラウドの画面と API で使わせない
 * （2026-10-29・自主診断 ASVS 9.2.3・10.3.1・lib/auth/foreign-client.ts）。
 */
describe('拠点向けのトークン', () => {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  function asSiteToken(clientId: string | null) {
    asRole('tenant_admin')
    const claims: Record<string, unknown> = { aal: 'aal1', n: ++tokenSeq }
    if (clientId) claims.client_id = clientId
    state.token = `${b64({ alg: 'none' })}.${b64(claims)}.sig`
  }

  it('API は 401', async () => {
    asSiteToken('site-client-1')
    const res = await middleware(req('/api/vod'))
    expect(res.status).toBe(401)
  })

  it('画面はログインへ', async () => {
    asSiteToken('site-client-1')
    const res = await middleware(req('/stores'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('★キャッシュの 2 回目も止める', async () => {
    asSiteToken('site-client-1')
    await middleware(req('/api/edges/e1/grid'))
    const res = await middleware(req('/api/edges/e1/grid'))
    expect(res.status).toBe(401)
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('クラウド自身のログインのトークンは通す', async () => {
    asSiteToken(null)
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
  })
})

/**
 * テナントを停止したら、画面も API も使わせない（2026-10-29・自主診断 ASVS 7.4.2）。
 */
describe('停止したテナントの利用者', () => {
  it('API は 403・画面は /suspended へ', async () => {
    asRole('tenant_admin')
    state.suspended = true
    try {
      const api = await middleware(req('/api/vod'))
      expect(api.status).toBe(403)
      asRole('tenant_admin')
      state.suspended = true
      const page = await middleware(req('/stores'))
      expect(new URL(page.headers.get('location')!).pathname).toBe('/suspended')
    } finally {
      state.suspended = false
    }
  })

  it('案内の画面とログインは止めない（許可パス）', async () => {
    asRole('tenant_admin')
    state.suspended = true
    try {
      for (const p of ['/suspended', '/login']) {
        const res = await middleware(req(p))
        expect(res.headers.get('location')).toBeNull()
      }
    } finally {
      state.suspended = false
    }
  })

  it('停止していなければ今までどおり', async () => {
    asRole('tenant_admin')
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
  })
})

/** 止めたときは [security] の 1 行をログに書く（2026-10-29・自主診断 ASVS 16.3.2）。 */
describe('止めたことの記録', () => {
  it('停止したテナントで止めると auth.tenant_suspended を書く', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    asRole('tenant_admin')
    state.suspended = true
    try {
      await middleware(req('/api/vod'))
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[security] '))
      expect(lines.some((l) => JSON.parse(l.slice(11)).kind === 'auth.tenant_suspended')).toBe(true)
    } finally {
      state.suspended = false
      warn.mockRestore()
    }
  })
})
