import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * BCP のテスト発令（POST /api/bcp/test）— 証跡を取れる先が無い拠点の扱い（2026-10-06）。
 *
 *   ★G・VMS が未設置の拠点は、発令の時点で failed にする（取得中のまま 24 時間残さない）
 *   ★エッジはあるがカメラが無い拠点も failed
 *   ★取れる拠点は従来どおり recording にし、エッジへ取得の指示を書く
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
  createSupabaseService: () => h.db.client,
}))
vi.mock('@/lib/tenant/monitor-scope', () => ({
  resolveMonitorScope: async () => ({
    ctx: { role: 'tenant_admin' }, needsTenant: false, storeIds: ['s-none', 's-empty', 's-edge'],
  }),
}))

import { POST } from './route'

const near = { latitude: 35.6987, longitude: 139.7731 } // 秋葉原
function seed() {
  h.db = createFakeDb({
    stores: [
      { id: 's-none', name: '電気秋葉原デモ店', area_code: '13000', ...near },
      { id: 's-empty', name: 'カメラなし店', area_code: '13000', ...near },
      { id: 's-edge', name: '銀座デモ店', area_code: '13000', ...near },
    ],
    edge_devices: [
      { id: 'e-empty', store_id: 's-empty', status: 'idle', recorders: [] },
      {
        id: 'e1', store_id: 's-edge', status: 'idle',
        recorders: [{ id: 'r1', vendor: 'hikvision', bcp_capture_mode: null, bcp_folder_paths: null,
          recorder_cameras: [{ id: 'c1', name: 'カメラ1', channel: 1, folder_path: null, enabled: true }] }],
      },
    ],
    bcp_events: [], bcp_clips: [], bcp_grid_shots: [], bcp_settings: [],
  })
}

const call = () => POST(new NextRequest('http://localhost/api/bcp/test', {
  method: 'POST',
  body: JSON.stringify({ lat: near.latitude, lng: near.longitude, radiusKm: 5, alertType: 'earthquake' }),
}))
const eventOf = (storeId: string) => h.db.rows('bcp_events').find((r) => r.store_id === storeId)!

beforeEach(seed)

describe('POST /api/bcp/test — 証跡を取れる先が無い拠点', () => {
  it('★未設置の拠点とカメラの無い拠点は failed・取れる拠点は recording', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).eventIds).toHaveLength(3)

    expect(eventOf('s-none').status).toBe('failed')
    expect(eventOf('s-empty').status).toBe('failed')
    expect(eventOf('s-edge').status).toBe('recording')

    // 取れる拠点だけにクリップの先置きと取得の指示
    expect(h.db.rows('bcp_clips').map((c) => c.event_id)).toEqual([eventOf('s-edge').id])
    const e1 = h.db.rows('edge_devices').find((e) => e.id === 'e1')!
    expect((e1.pending_command as { action: string }).action).toBe('start_bcp_capture')
    const eEmpty = h.db.rows('edge_devices').find((e) => e.id === 'e-empty')!
    expect(eEmpty.pending_command ?? null).toBeNull()
  })
})
