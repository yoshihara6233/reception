import { describe, expect, it, vi } from 'vitest'
import { clientIp, rateLimitAllows } from './rate-limit'

/**
 * 無認証ルートの回数制限。判定そのものは DB 側の rate_limit_hit（1 文の UPSERT）
 * が持つので、ここで見るのは**呼び出し側の契約**:
 *   - 引数の組み立て（キー・上限・窓）
 *   - DB エラー時にフェイルオープンすること（意図的な方針）
 *   - IP の取り出し（Vercel は x-forwarded-for の先頭が実クライアント）
 */

function svc(result: { data?: unknown; error?: { message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
    },
  }
  return { client: client as never, calls }
}

describe('rateLimitAllows', () => {
  it('上限内なら true', async () => {
    const { client } = svc({ data: true })
    expect(await rateLimitAllows(client, 'k', 3, 3600)).toBe(true)
  })

  it('上限超過なら false', async () => {
    const { client } = svc({ data: false })
    expect(await rateLimitAllows(client, 'k', 3, 3600)).toBe(false)
  })

  it('rate_limit_hit へキー・上限・窓をそのまま渡す', async () => {
    const { client, calls } = svc({ data: true })
    await rateLimitAllows(client, 'reset-link:email:a@example.com', 3, 3600)
    expect(calls).toEqual([{
      fn: 'rate_limit_hit',
      args: { p_key: 'reset-link:email:a@example.com', p_limit: 3, p_window: '3600 seconds' },
    }])
  })

  it('DB エラー時は通す（フェイルオープン）', async () => {
    // 意図的な方針。DB が落ちているときにパスワード再設定まで巻き添えで
    // 止めるのは割に合わない。**認可の判定でこれを真似しないこと。**
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = svc({ error: { message: 'boom' } })
    expect(await rateLimitAllows(client, 'k', 3, 3600)).toBe(true)
    warn.mockRestore()
  })

  it('data が null でも通す（関数が値を返さない異常系）', async () => {
    const { client } = svc({ data: null })
    expect(await rateLimitAllows(client, 'k', 3, 3600)).toBe(true)
  })
})

describe('clientIp', () => {
  const withHeaders = (h: Record<string, string>) =>
    new Request('http://localhost/', { headers: h })

  it('x-forwarded-for の先頭を取る（Vercel は先頭が実クライアント）', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' })))
      .toBe('203.0.113.9')
  })

  it('前後の空白を落とす', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '  203.0.113.9 , 10.0.0.1' }))).toBe('203.0.113.9')
  })

  it('x-forwarded-for が無ければ x-real-ip', () => {
    expect(clientIp(withHeaders({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('どちらも無ければ null（IP 単位の制限は掛けない・メール単位は残る）', () => {
    expect(clientIp(withHeaders({}))).toBeNull()
  })

  it('空文字の x-forwarded-for を IP として扱わない', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '' }))).toBeNull()
  })
})
