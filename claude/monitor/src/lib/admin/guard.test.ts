import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 認可ガードは「呼ぶだけ」では止まらない。**拒否したときに DB クライアントを
 * 渡さない**ことを、型と実行時の両方で固定する。
 *
 * ── なぜ必要か（2026-08-14 の検査 L-8）──────────────────────────────────
 * `requireAdmin()` は例外を投げず `{ ok: false, ... }` を**返す**。加えて以前は
 * `supa`（Supabase クライアント）を成功・失敗の**両分岐**に載せていたため、
 * 次のコードが **TypeScript の型検査を通っていた** — 認可を一切していないのに:
 *
 *     const { supa } = await requireAdmin()
 *
 * さらに悪いことに、ルート棚卸し（`api-guard-inventory.test.ts`）は正規表現で
 * ソースを見るので、こう書かれていても「requireAdmin を呼んでいる ＝ admin で
 * 守られている」と分類する。**表の上では守られて見える。**
 *
 * 検査時点では 35 ルートすべてが `!ok` で早期 return しており実害は無かった。
 * 指摘は「現状そうなっているだけで、構造的には防がれていない」という点だった。
 *
 * ── 何を見るか ──────────────────────────────────────────────────────────
 * ① 型: 拒否されうる戻り値から `supa` に触れるとコンパイルが落ちること。
 *    `@ts-expect-error` で固定する。**失敗分岐に `supa` が戻ると、この
 *    ディレクティブが「不要」になって `tsc` が落ちる**（＝ CI で気づける）。
 * ② 実行時: 401/403 の戻り値に `supa` キーが存在しないこと。
 *    型だけだと `as any` で迂回できるので、実物の形も見る。
 */

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { id: string; role: string; tenant_id: string; store_ids: string[] } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: h.profile }) }),
      }),
    }),
  }),
}))

import { requireAdmin, requireSuperAdmin } from './guard'

beforeEach(() => {
  h.user = null
  h.profile = null
})

describe('requireRole — 拒否したときに DB クライアントを渡さない', () => {
  it('★未ログインは 401 を返し、supa を持たない', async () => {
    const g = await requireAdmin()
    expect(g.ok).toBe(false)
    expect(g).not.toHaveProperty('supa')
    expect(g).toMatchObject({ status: 401, error: 'unauthorized' })
  })

  it('★ロール不足は 403 を返し、supa を持たない', async () => {
    h.user = { id: 'u1' }
    h.profile = { id: 'a1', role: 'viewer', tenant_id: 't1', store_ids: [] }
    const g = await requireAdmin()
    expect(g.ok).toBe(false)
    expect(g).not.toHaveProperty('supa')
    expect(g).toMatchObject({ status: 403, error: 'forbidden' })
  })

  it('admin_users の行が無い場合も 403 で、supa を持たない', async () => {
    h.user = { id: 'u1' }
    h.profile = null
    const g = await requireAdmin()
    expect(g).not.toHaveProperty('supa')
    expect(g).toMatchObject({ status: 403 })
  })

  it('通ったときだけ supa と profile が付く', async () => {
    h.user = { id: 'u1' }
    h.profile = { id: 'a1', role: 'super_admin', tenant_id: 't1', store_ids: [] }
    const g = await requireSuperAdmin()
    expect(g.ok).toBe(true)
    if (!g.ok) throw new Error('unreachable')
    expect(g.supa).toBeDefined()
    expect(g.profile.role).toBe('super_admin')
  })

  it('★型: ok を確かめる前に supa は使えない（コンパイル時の固定）', () => {
    // ⚠ 「プロパティが存在しない」ではない。TypeScript は同一関数から返る
    //   オブジェクトリテラルの共用体を**正規化**し、欠けている側に
    //   `supa?: undefined` を足す。したがって `g.supa` への**参照**は通り、
    //   型は `SupabaseClient | undefined` になる。
    //   守りが効くのは**使おうとしたとき**（strictNullChecks の TS18048）。
    //   最初この違いを取り違えてテストを書き、tsc に指摘された。
    //
    // ⚠ この関数は**呼ばない**。`@ts-expect-error` が抑えるのは型エラーだけで、
    //   その行は実行されれば普通に落ちる。ここで見たいのは tsc の判定のみ。
    const neverCalled = async () => {
      // 認可を通す前に使うと 'g.supa' is possibly 'undefined'（TS18048）。
      // **失敗分岐に supa を戻すと次の行がエラーでなくなり、抑止ディレクティブが
      // 「不要」と判定されて tsc が落ちる。** それがこの検査の本体。
      //
      // ⚠ 説明文に抑止ディレクティブの綴りを書かないこと。コメントの中でも
      //   TypeScript は指示として解釈するので、掛かる先がずれて検査が空振りする
      //   （2026-08-14、実際にこれで一度空振りした）。
      const g = await requireAdmin()
      // @ts-expect-error
      void g.supa.from('admin_users')

      // 実際に危なかったのはこの形。棚卸し（api-guard-inventory）は正規表現で
      // 見るので、これも「requireAdmin を呼んでいる ＝ admin」と分類される。
      const { supa } = await requireAdmin()
      // @ts-expect-error
      void supa.from('admin_users')

      // 絞り込んだ後は使える（型が壊れていないことの確認。ここは通ること）。
      if (g.ok) void g.supa.from('admin_users')
    }
    expect(neverCalled).toBeTypeOf('function')
  })
})
