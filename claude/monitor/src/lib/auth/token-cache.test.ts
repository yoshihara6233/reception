import { describe, expect, it } from 'vitest'
import {
  TOKEN_CACHE_TTL_MS,
  createTokenCache,
  hashToken,
  jwtExpiresAtMs,
} from './token-cache'

/** exp（秒）だけを持つ、署名のないダミー JWT。検証はしないので3セグメントあれば足りる。 */
function tokenWithExp(expSec: number | null, salt = 'x'): string {
  const body = expSec === null ? { sub: salt } : { sub: salt, exp: expSec }
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  return `header.${payload}.sig`
}

describe('hashToken', () => {
  it('生のトークンを含まない固定長の16進を返す', async () => {
    const h = await hashToken('super-secret-access-token')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(h).not.toContain('secret')
  })

  it('同じ入力は同じ、違う入力は違う', async () => {
    expect(await hashToken('a')).toBe(await hashToken('a'))
    expect(await hashToken('a')).not.toBe(await hashToken('b'))
  })
})

describe('jwtExpiresAtMs', () => {
  it('exp を ms に直して返す', () => {
    expect(jwtExpiresAtMs(tokenWithExp(1_700_000_000))).toBe(1_700_000_000_000)
  })

  it('exp が無ければ null（TTL だけで切る）', () => {
    expect(jwtExpiresAtMs(tokenWithExp(null))).toBeNull()
  })

  it('壊れた入力でも投げずに null', () => {
    expect(jwtExpiresAtMs('not-a-jwt')).toBeNull()
    expect(jwtExpiresAtMs('a.!!!.c')).toBeNull()
    expect(jwtExpiresAtMs('')).toBeNull()
  })

  it('base64url の - と _ を含むペイロードも読める', () => {
    // '-' '_' が出るまで salt を伸ばす。標準 base64 デコードだと壊れるケースの回帰。
    let token = ''
    for (let i = 0; i < 200 && !/[-_]/.test(token.split('.')[1] ?? ''); i++) {
      token = tokenWithExp(1_700_000_000, `pad${'~'.repeat(i)}?`)
    }
    expect(token.split('.')[1]).toMatch(/[-_]/)
    expect(jwtExpiresAtMs(token)).toBe(1_700_000_000_000)
  })
})

describe('createTokenCache', () => {
  it('未記録は undefined（＝呼び出し側に実検証させる）', () => {
    const c = createTokenCache<string>()
    expect(c.read('h1', 's', 0)).toBeUndefined()
  })

  it('書いた値を TTL 内は返す', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', null, 0)
    expect(c.read('h1', 's', TOKEN_CACHE_TTL_MS - 1)).toEqual({ value: 'v' })
  })

  it('TTL 到達で失効する（失効・権限変更が最大 TTL 遅れで効く）', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', null, 0)
    expect(c.read('h1', 's', TOKEN_CACHE_TTL_MS)).toBeUndefined()
  })

  it('★トークンの exp が TTL より近ければ exp で切る', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', 10_000, 0)   // 10秒後に失効するトークン
    expect(c.read('h1', 's', 9_999)).toEqual({ value: 'v' })
    expect(c.read('h1', 's', 10_000)).toBeUndefined()
  })

  it('exp が TTL より先でもキャッシュは伸ばさない', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', 3_600_000, 0)  // 1時間先
    expect(c.read('h1', 's', TOKEN_CACHE_TTL_MS)).toBeUndefined()
  })

  it('★トークンが違えば共有しない（利用者をまたいだ判定の使い回しを防ぐ）', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', null, 0)
    expect(c.read('h2', 's', 0)).toBeUndefined()
  })

  it('★scope が違えば共有しない（エッジAが見えてもエッジBが見えるとは限らない）', () => {
    const c = createTokenCache<string>()
    c.write('h1', 'edgeA', 'v', null, 0)
    expect(c.read('h1', 'edgeB', 0)).toBeUndefined()
  })

  it('false / null もちゃんと値として往復する（拒否・未ログインを覚えるため）', () => {
    const c = createTokenCache<boolean | null>()
    c.write('h1', 'role', false, null, 0)
    c.write('h2', 'role', null, null, 0)
    expect(c.read('h1', 'role', 0)).toEqual({ value: false })
    expect(c.read('h2', 'role', 0)).toEqual({ value: null })
  })

  it('期限切れのエントリは読み出し時に捨てる（無限に溜めない）', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', null, 0)
    expect(c.size()).toBe(1)
    c.read('h1', 's', TOKEN_CACHE_TTL_MS)
    expect(c.size()).toBe(0)
  })

  it('reset で全部消える', () => {
    const c = createTokenCache<string>()
    c.write('h1', 's', 'v', null, 0)
    c.reset()
    expect(c.read('h1', 's', 0)).toBeUndefined()
  })
})
