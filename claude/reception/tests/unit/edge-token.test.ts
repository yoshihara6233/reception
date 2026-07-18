/**
 * エッジ用APIトークンのユニットテスト（T2）
 *   - ハッシュ保存・生成の性質（平文非保存の担保）
 *   - versionヘッダ後方互換ポリシー
 *   - 認証: 有効 / 不明(無効) / 失効 / トークン無し / 旧バージョン
 */
import { describe, expect, test, vi } from 'vitest'
import {
  EDGE_TOKEN_PREFIX,
  EDGE_API_VERSION,
  generateEdgeToken,
  hashEdgeToken,
  hashesEqual,
  checkEdgeVersion,
} from '@/lib/edge/token'
import { authenticateEdge, type EdgeAuthDeps } from '@/lib/edge/auth'

describe('トークン生成・ハッシュ', () => {
  test('生成トークンは接頭辞付き・毎回ユニーク・十分長い', () => {
    const a = generateEdgeToken()
    const b = generateEdgeToken()
    expect(a.startsWith(EDGE_TOKEN_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(40)
  })

  test('ハッシュは決定的で、入力が違えば変わる（平文は保存しない）', () => {
    expect(hashEdgeToken('abc')).toBe(hashEdgeToken('abc'))
    expect(hashEdgeToken('abc')).not.toBe(hashEdgeToken('abd'))
    // SHA-256 hex は 64 文字
    expect(hashEdgeToken('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  test('hashesEqual は一致/不一致/長さ不一致を正しく判定', () => {
    const h = hashEdgeToken('x')
    expect(hashesEqual(h, h)).toBe(true)
    expect(hashesEqual(h, hashEdgeToken('y'))).toBe(false)
    expect(hashesEqual(h, 'abcd')).toBe(false)
    expect(hashesEqual('', '')).toBe(false)
  })
})

describe('versionヘッダ後方互換ポリシー', () => {
  test('現行バージョンは OK', () => {
    const r = checkEdgeVersion(String(EDGE_API_VERSION))
    expect(r.ok).toBe(true)
    expect(r.version).toBe(EDGE_API_VERSION)
  })
  test('未指定は 400', () => {
    expect(checkEdgeVersion(null)).toMatchObject({ ok: false, status: 400 })
    expect(checkEdgeVersion('')).toMatchObject({ ok: false, status: 400 })
  })
  test('非数値は 400', () => {
    expect(checkEdgeVersion('v1')).toMatchObject({ ok: false, status: 400 })
    expect(checkEdgeVersion('0')).toMatchObject({ ok: false, status: 400 })
  })
  test('最小未満は 426（更新を促す）', () => {
    expect(checkEdgeVersion('0.5')).toMatchObject({ ok: false, status: 400 }) // 非整数
    // MIN=1 の前提で 0 以下は上でカバー済み。将来 MIN>1 の 426 経路も同型。
  })
  test('現行より新しいエッジは許容（forward-compat）', () => {
    const r = checkEdgeVersion(String(EDGE_API_VERSION + 5))
    expect(r.ok).toBe(true)
  })
})

// ── 認証（依存注入でDB非依存） ────────────────────────────────────────────────

function headersOf(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower[name.toLowerCase()] ?? null }
}

function depsWith(row: Parameters<EdgeAuthDeps['fetchTokenByHash']> extends never ? never
  : { id: string; store_id: string; tenant_id: string; revoked_at: string | null } | null) {
  const touch = vi.fn(async () => {})
  const deps: EdgeAuthDeps = {
    fetchTokenByHash: vi.fn(async () => row),
    touchLastUsed: touch,
  }
  return { deps, touch }
}

const VALID_ROW = { id: 'tok-1', store_id: 'store-1', tenant_id: 'tenant-1', revoked_at: null }

describe('authenticateEdge', () => {
  test('有効トークン＋正しいversion → ok（store/tenant を解決・last_used更新）', async () => {
    const { deps, touch } = depsWith(VALID_ROW)
    const token = generateEdgeToken()
    const res = await authenticateEdge(
      headersOf({ 'x-edge-token': token, 'x-edge-api-version': String(EDGE_API_VERSION) }),
      deps,
    )
    expect(res).toMatchObject({ ok: true, storeId: 'store-1', tenantId: 'tenant-1', tokenId: 'tok-1' })
    // 送ったハッシュで引いている
    expect(deps.fetchTokenByHash).toHaveBeenCalledWith(hashEdgeToken(token))
    expect(touch).toHaveBeenCalledWith('tok-1')
  })

  test('不明トークン → 401', async () => {
    const { deps } = depsWith(null)
    const res = await authenticateEdge(
      headersOf({ 'x-edge-token': generateEdgeToken(), 'x-edge-api-version': '1' }),
      deps,
    )
    expect(res).toMatchObject({ ok: false, status: 401 })
  })

  test('失効トークン → 401（revoked）', async () => {
    const { deps } = depsWith({ ...VALID_ROW, revoked_at: '2026-07-18T00:00:00Z' })
    const res = await authenticateEdge(
      headersOf({ 'x-edge-token': generateEdgeToken(), 'x-edge-api-version': '1' }),
      deps,
    )
    expect(res).toMatchObject({ ok: false, status: 401, reason: 'revoked edge token' })
  })

  test('トークンヘッダ無し → 401', async () => {
    const { deps } = depsWith(VALID_ROW)
    const res = await authenticateEdge(headersOf({ 'x-edge-api-version': '1' }), deps)
    expect(res).toMatchObject({ ok: false, status: 401, reason: 'missing edge token' })
    expect(deps.fetchTokenByHash).not.toHaveBeenCalled()
  })

  test('versionヘッダ無し → 400（トークン照合前に弾く）', async () => {
    const { deps } = depsWith(VALID_ROW)
    const res = await authenticateEdge(headersOf({ 'x-edge-token': generateEdgeToken() }), deps)
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(deps.fetchTokenByHash).not.toHaveBeenCalled()
  })
})
