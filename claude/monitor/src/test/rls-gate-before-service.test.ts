import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 「RLS で見えるものだけを、そのあと service role で処理する」順序の契約テスト。
 *
 * createSupabaseService() は RLS を迂回する（81 ファイルで使用）。ログイン確認
 * だけで直に service role へ移り、ID 一本でレコードを引くルートがあると、
 * **ID を知っている誰でも他テナントのデータに到達できる**（IDOR）。
 *
 * 実際に 2 本あった（2026-08-09・89 ルートのガード棚卸しで発見）:
 *   /api/bcp/[id]/generate-report : 他テナントの BCP レポートを生成・取得できた
 *                                   （店舗名・住所・発令内容・クリップ）
 *   /api/sessions                 : 他テナントの店舗で視聴セッション行を作れた
 *                                   （＝相手の同時視聴枠を消費できた）
 *
 * 検証するのは戻り値だけでなく **service client を組み立てていないこと**。
 * 「見えない ID では RLS 迂回に到達しない」が守りたい性質そのもので、
 * ステータスコードだけ合わせて順序が崩れる書き換えを許さないため。
 */

const h = vi.hoisted(() => ({
  /** セッションクライアント（RLS 適用）から見える id の集合 */
  visible: new Set<string>(),
  /** createSupabaseService() が呼ばれた回数 */
  serviceCalls: 0,
}))

vi.mock('@/lib/supabase/server', () => {
  const sessionClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => ({ data: h.visible.has(val) ? { id: val } : null, error: null }),
          single: async () => ({ data: h.visible.has(val) ? { id: val } : null, error: null }),
        }),
      }),
    }),
  }
  return {
    createSupabaseServer: async () => sessionClient,
    createSupabaseService: () => {
      h.serviceCalls += 1
      throw new Error('service client should not be reached for an invisible id')
    },
  }
})

beforeEach(() => {
  h.visible = new Set()
  h.serviceCalls = 0
})

const OTHER_TENANT_EVENT = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT_STORE = '22222222-2222-2222-2222-222222222222'

describe('/api/bcp/[id]/generate-report', () => {
  it('RLS で見えないイベントIDは 404（存在を教えない）', async () => {
    const { POST } = await import('@/app/api/bcp/[id]/generate-report/route')
    const res = await POST(
      new Request('http://localhost/api/bcp/x/generate-report', { method: 'POST' }) as never,
      { params: Promise.resolve({ id: OTHER_TENANT_EVENT }) },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('event_not_found')
  })

  it('見えないイベントでは service role を組み立てない（RLS 迂回に到達しない）', async () => {
    const { POST } = await import('@/app/api/bcp/[id]/generate-report/route')
    await POST(
      new Request('http://localhost/api/bcp/x/generate-report', { method: 'POST' }) as never,
      { params: Promise.resolve({ id: OTHER_TENANT_EVENT }) },
    )
    expect(h.serviceCalls).toBe(0)
  })
})

describe('/api/sessions', () => {
  const startBody = (storeId: string) => new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', mode: 'live', storeId }),
  })

  it('RLS で見えない店舗での開始は 403', async () => {
    const { POST } = await import('@/app/api/sessions/route')
    const res = await POST(startBody(OTHER_TENANT_STORE) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })

  it('見えない店舗では service role を組み立てない（同時視聴枠の集計に到達しない）', async () => {
    const { POST } = await import('@/app/api/sessions/route')
    await POST(startBody(OTHER_TENANT_STORE) as never)
    expect(h.serviceCalls).toBe(0)
  })
})
