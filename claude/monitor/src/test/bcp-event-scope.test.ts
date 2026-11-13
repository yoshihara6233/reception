import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * BCP の取り直し (POST /api/bcp/[id]/retrieve) とテスト発令の削除 (DELETE /api/bcp/events) が、
 * 別テナントのイベントに届かないこと（2026-11-13・見直し C-3）。
 *
 * 以前は役割だけを確かめて service role で ID 一本で引いていたため、別テナントの管理者でも
 * イベントの ID が分かれば、他テナントの拠点へ撮影の指示を書き、テスト発令を画像ごと消せた。
 *
 *   ★見えないイベントの取り直しは 404（エッジへの指示も、状態の書き換えも起きない）
 *   ★見えないイベントの削除は 404（行は残る）
 *   ★見えるものと見えないものを混ぜて渡すと、見えるものだけが消える
 *   ★見えるイベントは、これまでどおり先へ進む
 *
 * 偽の DB に RLS は無いので、「利用者の権限で見える行」だけを持つ DB（userDb）と、
 * 全部の行を持つ DB（svcDb = service role）の 2 つを用意して見分ける。
 */

const MINE  = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  userDb: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  svcDb:  null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
}))
vi.mock('@/lib/admin/guard', () => ({
  requireAdmin: async () => ({
    ok: true as const,
    user: { id: 'u-a' },
    profile: { id: 'p-a', role: 'tenant_admin', tenant_id: 't-a', store_ids: [] },
    supa: h.userDb.client,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => h.userDb.client,
  createSupabaseService: () => h.svcDb.client,
}))

import { POST as retrieve } from '@/app/api/bcp/[id]/retrieve/route'
import { DELETE as deleteEvents } from '@/app/api/bcp/events/route'

const event = (id: string, storeId: string) => ({
  id, store_id: storeId, is_test: true, status: 'failed',
  alert_issued_at: '2026-11-13T03:00:00.000Z', raw_purged_at: null,
})

function seed() {
  const mine  = event(MINE, 's-a')
  const other = event(OTHER, 's-b')
  // 利用者 (テナント A の管理者) に見えるのは、自分のテナントのイベントだけ
  h.userDb = createFakeDb({ bcp_events: [mine] })
  h.svcDb = createFakeDb({
    bcp_events: [mine, other],
    bcp_clips: [
      { id: 'c-a', event_id: MINE,  storage_path: 'a/1.jpg' },
      { id: 'c-b', event_id: OTHER, storage_path: 'b/1.jpg' },
    ],
    bcp_reports: [{ id: 'r-b', event_id: OTHER }],
    edge_devices: [
      { id: 'e-b', store_id: 's-b', status: 'idle', pending_command: null, recorders: [
        { id: 'rec-b', vendor: 'hikvision', bcp_capture_mode: null, bcp_folder_paths: null,
          recorder_cameras: [{ id: 'cam-b', name: '入口', channel: 1, folder_path: null, enabled: true }] },
      ] },
    ],
  })
}

const svcRows = (t: string) => h.svcDb.tables[t] as Record<string, unknown>[]

function del(ids: string[]) {
  return deleteEvents(new NextRequest('http://localhost/api/bcp/events', {
    method: 'DELETE', body: JSON.stringify({ eventIds: ids }), headers: { 'content-type': 'application/json' },
  }))
}
function retr(id: string) {
  return retrieve(new NextRequest(`http://localhost/api/bcp/${id}/retrieve`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })
}

describe('BCP: 別テナントのイベントに届かない (C-3)', () => {
  beforeEach(seed)

  it('見えないイベントの取り直しは 404 で、エッジへの指示も状態の書き換えも起きない', async () => {
    const res = await retr(OTHER)
    expect(res.status).toBe(404)
    expect(svcRows('edge_devices').find((e) => e.id === 'e-b')?.pending_command).toBeNull()
    expect(svcRows('bcp_events').find((e) => e.id === OTHER)?.status).toBe('failed')
    expect(svcRows('bcp_clips')).toHaveLength(2)
  })

  it('見えるイベントの取り直しは、権限の確認を通って先へ進む', async () => {
    // テナント A の拠点には稼働中のエッジを置いていないので、確認の後の 409 で止まる
    const res = await retr(MINE)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_active_edge')
  })

  it('見えないイベントの削除は 404 で、行もクリップも残る', async () => {
    const res = await del([OTHER])
    expect(res.status).toBe(404)
    expect(svcRows('bcp_events').some((e) => e.id === OTHER)).toBe(true)
    expect(svcRows('bcp_clips').some((c) => c.event_id === OTHER)).toBe(true)
    expect(svcRows('bcp_reports').some((r) => r.event_id === OTHER)).toBe(true)
  })

  it('見えるものと見えないものを混ぜると、見えるものだけが消える', async () => {
    const res = await del([MINE, OTHER])
    expect(res.status).toBe(200)
    expect((await res.json()).deleted).toBe(1)
    expect(svcRows('bcp_events').map((e) => e.id)).toEqual([OTHER])
    expect(svcRows('bcp_clips').map((c) => c.id)).toEqual(['c-b'])
    expect(svcRows('bcp_reports')).toHaveLength(1)
  })
})
