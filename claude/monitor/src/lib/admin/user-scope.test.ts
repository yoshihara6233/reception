import { describe, expect, it } from 'vitest'
import { storeIdsBelongToTenant } from './user-scope'

/**
 * admin_users.store_ids は RLS の `... = ANY(auth_user_store_ids())` 経由で
 * その店舗の SELECT 権限をそのまま与える。つまり**他テナントの店舗IDを1つ
 * 混ぜるだけで越権閲覧が成立する**。ユーザー作成/更新の入口はここしかないので、
 * 素通りする条件が無いことを固定しておく（PR #209 の再発防止）。
 */

/** stores を `.in('id', ids).eq('tenant_id', t)` で引くところだけ模したスタブ。 */
function svc(storeToTenant: Record<string, string>, opts: { error?: boolean } = {}) {
  const calls: { ids: string[]; tenantId: string }[] = []
  const client = {
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => ({
          eq: (_c2: string, tenantId: string) => {
            calls.push({ ids, tenantId })
            if (opts.error) return Promise.resolve({ data: null, error: { message: 'boom' } })
            const data = ids.filter((id) => storeToTenant[id] === tenantId).map((id) => ({ id }))
            return Promise.resolve({ data, error: null })
          },
        }),
      }),
    }),
  }
  return { client: client as never, calls }
}

const MAP = { 'a1': 'tenant-a', 'a2': 'tenant-a', 'b1': 'tenant-b' }

describe('storeIdsBelongToTenant', () => {
  it('空配列は常に許可（担当店舗なしは正常な状態）', async () => {
    const { client, calls } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, [], 'tenant-a')).toBe(true)
    expect(await storeIdsBelongToTenant(client, [], null)).toBe(true)
    expect(calls).toHaveLength(0) // 問い合わせすら不要
  })

  it('自テナントの店舗だけなら許可', async () => {
    const { client } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1', 'a2'], 'tenant-a')).toBe(true)
  })

  it('他テナントの店舗が 1 つでも混じれば拒否', async () => {
    const { client } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1', 'b1'], 'tenant-a')).toBe(false)
  })

  it('存在しない店舗IDは拒否（実在しないIDを黙って通さない）', async () => {
    const { client } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1', 'ghost'], 'tenant-a')).toBe(false)
  })

  it('tenantId=null で店舗を持たせようとしたら拒否（super_admin は店舗スコープを持てない）', async () => {
    const { client, calls } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1'], null)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('重複IDは重複排除して判定する（件数比較が重複で狂わない）', async () => {
    // 実装は Set で正規化してから件数を突き合わせる。素の配列長と比べると
    // ['a1','a1'] が「2件要求・1件一致」で誤って拒否される。
    const { client, calls } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1', 'a1', 'a2'], 'tenant-a')).toBe(true)
    expect(calls[0].ids).toEqual(['a1', 'a2'])
  })

  it('重複させて他テナント店舗を紛れ込ませても拒否', async () => {
    const { client } = svc(MAP)
    expect(await storeIdsBelongToTenant(client, ['a1', 'a1', 'b1'], 'tenant-a')).toBe(false)
  })

  it('クエリが失敗したら拒否（フェイルクローズ）', async () => {
    // 権限系はフェイルオープンにしない。取得できない＝検証できない＝通さない。
    const { client } = svc(MAP, { error: true })
    expect(await storeIdsBelongToTenant(client, ['a1'], 'tenant-a')).toBe(false)
  })

  it('検証は必ずテナントで絞ったクエリで行う', async () => {
    const { client, calls } = svc(MAP)
    await storeIdsBelongToTenant(client, ['a1'], 'tenant-a')
    expect(calls[0]).toEqual({ ids: ['a1'], tenantId: 'tenant-a' })
  })
})
