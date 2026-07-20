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
const state: { user: { id: string } | null; role: string | null } = { user: null, role: null }
const getUserMock = vi.fn(async () => ({ data: { user: state.user } }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.role === null ? null : { role: state.role } }),
        }),
      }),
    }),
  }),
}))

import { middleware } from './middleware'

const req = (path: string) => new NextRequest(`https://monitor.test${path}`)

function asRole(role: string | null) {
  state.user = role === null ? null : { id: 'u-1' }
  state.role = role
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  getUserMock.mockClear()
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

  it('店舗別キオスク manifest（/kiosk 配下 .webmanifest）→ 素通し', async () => {
    asRole('baggage_manager')
    const res = await middleware(req('/kiosk/baggage/store-1/manifest.webmanifest'))
    expect(res.status).toBe(200)
  })
})

describe('admin_users 行が無い認証済みユーザー（プロビジョニング不全）', () => {
  it('/stores → 素通し（baggage_manager ではないため制限対象外）', async () => {
    state.user = { id: 'u-orphan' }
    state.role = null
    const res = await middleware(req('/stores'))
    expect(res.status).toBe(200)
  })
})
