import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ライブ画像ルートの入口ガード `requireEdgeViewAccess` 本体。
 *
 * ── なぜ別ファイルなのか ────────────────────────────────────────────────
 * 同じモジュールの純粋関数（resolveEdgeVisibility / toAccess）は
 * view-access.test.ts が押さえている。**押さえられていなかったのは
 * それらを組み立てる本体のほう**で、2026-08-09 の変異テストで
 * 35 個の変異が「テストに一度も触れられていない」と出た。
 *
 * ここは Supabase クライアントのモックが要るので、素の純粋関数テストとは
 * 前提が違う。混ぜると view-access.test.ts の見通しが悪くなるため分けた。
 *
 * ── 何を守るのか ────────────────────────────────────────────────────────
 * このルートは R2 の署名 URL / service_role で読むため **RLS を一切踏まない**。
 * つまりここのガードが唯一の壁で、抜けるとエッジ UUID を知っている
 * 別テナントの利用者に映像がそのまま渡る（2026-08-06 まで実際にそうだった）。
 *
 * 見るのは 4 点:
 *   ① 未ログインは 401、可視外は 403（取り違えない）
 *   ② 判定不能（DB 障害）は **403 にフェイルクローズ**する
 *   ③ その 403 を**キャッシュに焼き付けない**（瞬断で正当な利用者を締め出さない）
 *   ④ キャッシュが効いても、**別エッジには効かない**（キーはトークン×エッジ）
 */

const h = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  user: null as { id: string } | null,
  edgeRow: null as { id: string } | null,
  edgeError: null as unknown,
  edgeThrows: false,
  /** 実検証（getUser / edge_devices 引き）が走った回数。キャッシュ命中の確認に使う。 */
  getUserCalls: 0,
  edgeQueries: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      getUser: async () => { h.getUserCalls++; return { data: { user: h.user } } },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.edgeQueries++
            if (h.edgeThrows) throw new Error('boom')
            return { data: h.edgeRow, error: h.edgeError }
          },
        }),
      }),
    }),
  }),
}))

const U1 = '11111111-1111-4111-8111-111111111111'
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const E2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** 有効期限を十分先に置いた形だけの JWT（token-cache が exp を読む）。 */
function jwt(sub: string): string {
  const payload = Buffer
    .from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  return `header.${payload}.sig`
}

async function gate(edgeId: string) {
  const { requireEdgeViewAccess } = await import('./view-access')
  return requireEdgeViewAccess(edgeId)
}

beforeEach(async () => {
  const { resetViewAccessCache } = await import('./view-access')
  resetViewAccessCache()
  h.session = { access_token: jwt(U1) }
  h.user = { id: U1 }
  h.edgeRow = { id: E1 }
  h.edgeError = null
  h.edgeThrows = false
  h.getUserCalls = 0
  h.edgeQueries = 0
})
afterEach(() => { vi.restoreAllMocks() })

describe('requireEdgeViewAccess', () => {
  it('ログイン済み＋可視なら通す', async () => {
    expect(await gate(E1)).toEqual({ ok: true, userId: U1 })
  })

  it('未ログインは 401（403 ではない）', async () => {
    h.user = null
    expect(await gate(E1)).toEqual({ ok: false, status: 401 })
  })

  it('ログイン済みでも可視外なら 403（401 ではない）', async () => {
    // 他テナントのエッジは RLS で 0 行になる。**ログイン自体は有効**なので 401 にしない。
    h.edgeRow = null
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })
  })

  it('セッションが無くても実検証まで進む（トークン無しで素通りしない）', async () => {
    h.session = null
    h.user = null
    expect(await gate(E1)).toEqual({ ok: false, status: 401 })
    expect(h.getUserCalls, 'トークンが無いときに検証を省いています').toBe(1)
  })

  it('DB エラーは 403 にフェイルクローズする', async () => {
    // 監視映像は「見えて止まる」側に倒す。
    h.edgeError = { message: 'invalid input syntax for type uuid' }
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })
  })

  it('例外が飛んでも 403（500 を漏らさない）', async () => {
    h.edgeThrows = true
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })
  })

  it('★判定不能による 403 はキャッシュに焼き付けない', async () => {
    // ここが要点。DB の瞬断で false を 30 秒覚えると、**正当な利用者が
    // その間ずっと 403 を食い続ける**。復旧したら次の呼び出しで通るべき。
    h.edgeError = { message: 'connection reset' }
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })

    h.edgeError = null                    // 障害が復旧
    expect(await gate(E1), '瞬断の 403 を覚え込んでいます').toEqual({ ok: true, userId: U1 })
    expect(h.edgeQueries, '2 回目が実検証されていません').toBe(2)
  })

  it('可視の判定はキャッシュされ、2 回目は実検証しない', async () => {
    await gate(E1)
    await gate(E1)
    expect(h.getUserCalls).toBe(1)
    expect(h.edgeQueries).toBe(1)
  })

  it('★キャッシュはエッジ単位（別エッジには効かない）', async () => {
    // キーがトークンだけだと、1 台見えたら全台見えることになる。
    await gate(E1)
    h.edgeRow = null                      // E2 は見えない
    expect(await gate(E2), '別エッジにキャッシュが波及しています').toEqual({ ok: false, status: 403 })
    expect(h.edgeQueries, 'E2 が実検証されていません').toBe(2)
  })

  it('可視外の判定もキャッシュされる（403 の連打を吸収する）', async () => {
    h.edgeRow = null
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })
    expect(await gate(E1)).toEqual({ ok: false, status: 403 })
    expect(h.edgeQueries).toBe(1)
  })

  it('無効トークンの 401 もキャッシュされる（毎秒 Auth を叩かせない）', async () => {
    h.user = null
    expect(await gate(E1)).toEqual({ ok: false, status: 401 })
    expect(await gate(E1)).toEqual({ ok: false, status: 401 })
    expect(h.getUserCalls, '失効トークンで毎回 Auth を叩いています').toBe(1)
  })

  it('トークンが変われば別キー扱い（再ログインで締め出されない）', async () => {
    h.user = null
    await gate(E1)                        // 401 を覚える
    h.session = { access_token: jwt(U1) + 'x' }   // 再ログイン＝別トークン
    h.user = { id: U1 }
    expect(await gate(E1), '再ログイン後も締め出されています').toEqual({ ok: true, userId: U1 })
  })

  it('セッションが無いときはキャッシュを作らない（毎回実検証する）', async () => {
    h.session = null
    h.user = null
    await gate(E1)
    await gate(E1)
    expect(h.getUserCalls, 'トークン無しの結果を覚え込んでいます').toBe(2)
  })
})
