import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/vod` が **エッジへの取得指示に失敗したことを見える形にする**か。
 *
 * ── なぜここを見るのか ──────────────────────────────────────────────────
 * エッジが見にいく `edge_devices.pending_command` を書くのは
 * `/api/edges/[id]/commands` への呼び出しそのもの。ここで書けなければ、
 * エッジには**何も届かない**。旧実装はこの応答を
 * `.catch(() => {/* 次の poll で拾う *\/})` と握りつぶしていたが、その説明は誤りで、
 * 実際には **clip が queued のまま永久に止まり、画面には「準備中」が出続ける**。
 *
 * 命令の受け口を allowlist にしたことで、拒否されうる経路が増えている
 * （`/api/vod` が送る形とスキーマがずれれば 400）。**壊れたときに
 * 壊れたと分かる**ことを固定しておく。
 *
 * あわせて、`/api/vod` が実際に送っている形が allowlist を通ることも見る
 * （ここがずれると、上の 400 が現実に起きる）。
 */

const h = vi.hoisted(() => ({
  /** commands 受け口の応答 */
  dispatchOk: true,
  dispatchThrows: false,
  /** 送られた命令ボディ */
  sentBody: null as Record<string, unknown> | null,
  /** vod_clips に対して行われた update */
  updated: null as Record<string, unknown> | null,
  logged: [] as string[],
}))

const CAM  = '11111111-1111-4111-8111-111111111111'
const EDGE = '33333333-3333-4333-8333-333333333333'
const CLIP = '22222222-2222-4222-8222-222222222222'

vi.mock('@/lib/supabase/server', () => {
  const authClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: CAM, recorders: { id: 'r1', edge_id: EDGE, vendor: 'frigate', vod_host: null } },
            error: null,
          }),
        }),
      }),
    }),
  }
  const service = {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain,
        order: () => chain, limit: () => chain,
        insert: () => chain,
        update: (row: Record<string, unknown>) => {
          if (table === 'vod_clips') h.updated = row
          return chain
        },
        maybeSingle: async () => ({ data: null, error: null }),   // 再利用なし
        single:      async () => ({ data: { id: CLIP }, error: null }),
      }
      void q
      return chain
    },
  }
  return { createSupabaseServer: async () => authClient, createSupabaseService: () => service }
})

beforeEach(() => {
  h.dispatchOk = true
  h.dispatchThrows = false
  h.sentBody = null
  h.updated = null
  h.logged = []
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => { h.logged.push(String(m)) })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    h.sentBody = JSON.parse(init.body) as Record<string, unknown>
    if (h.dispatchThrows) throw new Error('network down')
    return { ok: h.dispatchOk, status: h.dispatchOk ? 200 : 400 }
  })
})

async function createClip() {
  const { POST } = await import('@/app/api/vod/route')
  const { NextRequest } = await import('next/server')
  const req = new NextRequest('http://localhost/api/vod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      camera_id: CAM,
      from_iso:  '2026-08-13T10:00:00+09:00',
      to_iso:    '2026-08-13T10:05:00+09:00',
    }),
  })
  const res = await POST(req)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('/api/vod の取得指示', () => {
  it('成功時は queued を返す', async () => {
    const r = await createClip()
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ clip_id: CLIP, status: 'queued' })
    expect(h.updated).toBeNull()
  })

  it('★受け口に拒否されたら failed に落とす（queued のまま放置しない）', async () => {
    h.dispatchOk = false
    const r = await createClip()

    expect(r.status).toBe(502)
    expect(h.updated).toMatchObject({ status: 'failed' })
    // 画面に出る文言。「準備中」が出続けるより、失敗と分かるほうがよい。
    expect(String(r.json.message)).toContain('送れませんでした')
    expect(h.logged.join()).toContain('[vod]')
  })

  it('★通信そのものが失敗しても同じ（例外を握りつぶさない）', async () => {
    h.dispatchThrows = true
    const r = await createClip()
    expect(r.status).toBe(502)
    expect(h.updated).toMatchObject({ status: 'failed' })
  })

  describe('★送っている形が allowlist を通る', () => {
    it('命令スキーマが受理する', async () => {
      await createClip()
      // 実際に送られたボディを、受け口と同じスキーマにかける。
      // ここがずれると VOD が本番で 400 になり、queued で止まる。
      const { POST } = await import('@/app/api/edges/[id]/commands/route')
      const { NextRequest } = await import('next/server')
      const res = await POST(
        new NextRequest('http://localhost/api/edges/e1/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(h.sentBody),
        }),
        { params: Promise.resolve({ id: 'e1' }) },
      )
      expect(res.status).not.toBe(400)
    })

    it('必要な項目が揃っている', async () => {
      await createClip()
      expect(h.sentBody).toMatchObject({ action: 'start_vod', camera_id: CAM, clip_id: CLIP })
      expect(h.sentBody).toHaveProperty('from_iso')
      expect(h.sentBody).toHaveProperty('to_iso')
    })
  })
})
