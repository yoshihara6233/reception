import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * エッジ auth ユーザの払い出し `ensureEdgeAuthPassword` 本体。
 *
 * ── なぜ別ファイルなのか ────────────────────────────────────────────────
 * 同じモジュールの純粋関数（edgeAuthEmail / mayWithholdServiceRole）は
 * auth-provision.test.ts が押さえている。**押さえられていなかったのは
 * 実際に鍵を作るこの関数**で、2026-08-09 の変異テストで 62 個の変異が
 * 「テストに一度も触れられていない」と出た。モジュール全体で 11%。
 *
 * ── 何を守るのか ────────────────────────────────────────────────────────
 * ここはエッジ 1 台ごとの Auth ユーザとパスワードを作る場所。GA 残タスク
 * 「bootstrap のエッジ専用スコープ鍵化」の中核で、間違えると
 *   ・パスワードが平文同然で DB に載る（鍵未設定時）
 *   ・エッジが scoped トークンを受け取れず丸腰になる
 *   ・app_metadata の詐称でスコープが壊れる
 * のいずれかが起きる。
 *
 * 見るのは 5 点:
 *   ① 鍵が無ければ**何もしない**（平文保存を作らない）
 *   ② 既存の払い出し済みは**使い回す**（毎回ローテしない）
 *   ③ 復号できないときは**作り直す**（鍵ローテで詰まない）
 *   ④ email 衝突は**引き当てて更新に回す**（同時実行で片肺にしない）
 *   ⑤ どこで失敗しても **null**（呼び出し側は scoped を出さずに続行する）
 */

const h = vi.hoisted(() => ({
  encFails: false,
  decFails: false,
  createResult: null as { user: { id: string } } | null,
  listUsers: [] as { id: string; email: string }[],
  updateError: null as unknown,
  writeError: null as unknown,
  storeRow: { tenant_id: 'tenant-1' } as { tenant_id: string } | null,
  calls: [] as string[],
  /** edge_devices に書き込まれた値（暗号化されているかの確認用）。 */
  written: null as Record<string, unknown> | null,
  lastAppMetadata: null as Record<string, unknown> | null,
}))

vi.mock('@intereco/shared', () => ({
  encryptSecret: (v: string) => {
    if (h.encFails) throw new Error('enc failed')
    return `enc:${v}`
  },
  decryptSecret: (v: string) => {
    if (h.decFails) throw new Error('dec failed')
    return v.replace(/^enc:/, '')
  },
}))

const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const S1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** service_role クライアントの最小ダブル。 */
function svc() {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.storeRow }) }) }),
      update: (values: Record<string, unknown>) => {
        h.calls.push(`update:${table}`)
        h.written = values
        return { eq: async () => ({ error: h.writeError }) }
      },
    }),
    auth: {
      admin: {
        createUser: async (args: { app_metadata?: Record<string, unknown> }) => {
          h.calls.push('createUser')
          h.lastAppMetadata = args.app_metadata ?? null
          return { data: h.createResult }
        },
        listUsers: async () => {
          h.calls.push('listUsers')
          return { data: { users: h.listUsers } }
        },
        updateUserById: async (_id: string, args: { app_metadata?: Record<string, unknown> }) => {
          h.calls.push('updateUserById')
          h.lastAppMetadata = args.app_metadata ?? null
          return { error: h.updateError }
        },
      },
    },
  } as never
}

async function ensure(edge: Record<string, unknown>, opts?: { rotate?: boolean }) {
  const { ensureEdgeAuthPassword } = await import('./auth-provision')
  return ensureEdgeAuthPassword(svc(), edge as never, opts)
}

let savedKey: string | undefined
beforeEach(() => {
  savedKey = process.env.SECRETS_ENC_KEY
  process.env.SECRETS_ENC_KEY = 'x'.repeat(32)
  h.encFails = false
  h.decFails = false
  h.createResult = { user: { id: 'auth-new' } }
  h.listUsers = []
  h.updateError = null
  h.writeError = null
  h.storeRow = { tenant_id: 'tenant-1' }
  h.calls = []
  h.written = null
  h.lastAppMetadata = null
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.SECRETS_ENC_KEY
  else process.env.SECRETS_ENC_KEY = savedKey
})

describe('ensureEdgeAuthPassword', () => {
  it('★SECRETS_ENC_KEY が無ければ何もせず null', async () => {
    // 鍵が無いと encryptSecret が `plain:` にフォールバックし、**パスワードが
    // 平文同然で DB に載る**。だから作らない、が正解。
    delete process.env.SECRETS_ENC_KEY
    expect(await ensure({ id: E1, store_id: S1 })).toBeNull()
    expect(h.calls, '鍵が無いのに Auth を触っています').toEqual([])
  })

  it('払い出し済みなら復号して使い回す（毎回ローテしない）', async () => {
    const pw = await ensure({
      id: E1, store_id: S1, auth_user_id: 'auth-1', auth_password_enc: 'enc:secret-pw',
    })
    expect(pw).toBe('secret-pw')
    expect(h.calls, '既存があるのに作り直しています').toEqual([])
  })

  it('rotate 指定なら払い出し済みでも作り直す', async () => {
    const pw = await ensure(
      { id: E1, store_id: S1, auth_user_id: 'auth-1', auth_password_enc: 'enc:old-pw' },
      { rotate: true },
    )
    expect(pw).not.toBe('old-pw')
    expect(h.calls).toContain('updateUserById')
  })

  it('復号できないときは作り直す（鍵ローテで詰まない）', async () => {
    h.decFails = true
    const pw = await ensure({
      id: E1, store_id: S1, auth_user_id: 'auth-1', auth_password_enc: 'enc:unreadable',
    })
    expect(pw).toBeTruthy()
    expect(h.calls).toContain('updateUserById')
  })

  it('片肺（auth_user_id だけ）なら更新に回す', async () => {
    // 過去の中断で auth_user_id はあるがパスワードが無い、という状態。
    await ensure({ id: E1, store_id: S1, auth_user_id: 'auth-1' })
    expect(h.calls).toContain('updateUserById')
    expect(h.calls, '既存 ID があるのに作成しています').not.toContain('createUser')
  })

  it('未払い出しなら作成する', async () => {
    const pw = await ensure({ id: E1, store_id: S1 })
    expect(pw).toBeTruthy()
    expect(h.calls).toContain('createUser')
    expect(h.calls, '作成直後に更新までしています').not.toContain('updateUserById')
  })

  it('★email 衝突は引き当てて更新に回す（同時実行で片肺にしない）', async () => {
    // bootstrap は 5 分ごとに来る。競合で createUser が失敗しても、
    // 既存ユーザを拾って更新できないと **そのエッジは永久に丸腰**になる。
    h.createResult = null
    h.listUsers = [{ id: 'auth-existing', email: `edge+${E1}@edge.intereco.local` }]
    const pw = await ensure({ id: E1, store_id: S1 })
    expect(pw).toBeTruthy()
    expect(h.calls).toEqual(['createUser', 'listUsers', 'updateUserById', 'update:edge_devices'])
  })

  it('email 衝突なのに引き当てられなければ null', async () => {
    h.createResult = null
    h.listUsers = [{ id: 'other', email: 'someone-else@example.com' }]
    expect(await ensure({ id: E1, store_id: S1 })).toBeNull()
  })

  it('app_metadata に edge_id / store_id / tenant_id / role が入る', async () => {
    // service_role でしか書けない＝エッジ側から詐称できないクレーム。
    await ensure({ id: E1, store_id: S1 })
    expect(h.lastAppMetadata).toEqual({
      edge_id: E1, store_id: S1, tenant_id: 'tenant-1', role: 'edge',
    })
  })

  it('店舗が引けなくても tenant_id は null で続行する', async () => {
    h.storeRow = null
    const pw = await ensure({ id: E1, store_id: S1 })
    expect(pw).toBeTruthy()
    expect(h.lastAppMetadata?.tenant_id).toBeNull()
  })

  it('★保存されるのは暗号化されたパスワード（平文を書かない）', async () => {
    const pw = await ensure({ id: E1, store_id: S1 })
    expect(h.written?.auth_user_id).toBe('auth-new')
    expect(h.written?.auth_password_enc).toBe(`enc:${pw}`)
    expect(String(h.written?.auth_password_enc), '平文が保存されています').not.toBe(pw)
  })

  it('更新に失敗したら null（半端な状態で成功を返さない）', async () => {
    h.updateError = { message: 'auth down' }
    expect(await ensure({ id: E1, store_id: S1, auth_user_id: 'auth-1' })).toBeNull()
  })

  it('DB 書き込みに失敗したら null', async () => {
    // パスワードは変わったのに保存できていない＝次回復号できない。成功扱いにしない。
    h.writeError = { message: 'write failed' }
    expect(await ensure({ id: E1, store_id: S1 })).toBeNull()
  })

  it('毎回ちがうパスワードを払い出す', async () => {
    const a = await ensure({ id: E1, store_id: S1 })
    const b = await ensure({ id: E1, store_id: S1 })
    expect(a).not.toBe(b)
    expect(String(a).length, 'パスワードが短すぎます').toBeGreaterThanOrEqual(32)
  })
})
