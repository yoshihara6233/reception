import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createAlarmFkDb, seedTwoEdges } from '@/test/fake-alarm-fk-db'

/**
 * エッジ削除 (DELETE /api/admin/edges/[id]) が、発報の記録が残っていても通ることを固定する (2026-10-16)。
 *
 * alarm_events.camera_id と alarm_frames.camera_id は recorder_cameras を ON DELETE の
 * 指定なしで参照している。以前のルートは edge_devices を消すだけだったので、旧エッジの
 * カメラに発報の記録が残っていると外部キー違反で 500 になっていた (拠点「PoC 熊本店」)。
 * 外部キーは src/test/fake-alarm-fk-db.ts で再現する。
 */

const h = vi.hoisted(() => ({
  guard: null as unknown,
  audits: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin/guard', () => ({ requireSuperAdmin: async () => h.guard }))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_s: unknown, e: Record<string, unknown>) => { h.audits.push(e) },
  storeIdForEdge: async () => 'store-1',
}))

import { DELETE } from './route'

const call = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/admin/edges/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) })

let fake: ReturnType<typeof createAlarmFkDb>

describe('DELETE /api/admin/edges/[id]', () => {
  beforeEach(() => {
    fake = createAlarmFkDb(seedTwoEdges())
    h.guard = { ok: true, user: { id: 'admin-1' }, supa: fake.client }
    h.audits = []
  })

  it('発報の記録が残っていても、先に消してからエッジを消す', async () => {
    const res = await call('old')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: { alarm_events: 1, alarm_frames: 2 } })

    const db = fake.state.db
    expect(db.edge_devices.map((e) => e.id)).toEqual(['live'])
    expect(db.alarm_events.map((a) => a.id)).toEqual(['a-live'])
    expect(db.alarm_frames.map((f) => f.id)).toEqual(['f-live'])
    // ほかのエッジのカメラ・レコーダには触れない
    expect(db.recorder_cameras.map((c) => c.id)).toEqual(['c-live-1'])
    expect(db.recorders.map((r) => r.id)).toEqual(['r-live'])
    // 消す順番: コマ → 発報 → エッジ
    expect(fake.state.deletes).toEqual(['alarm_frames', 'alarm_events', 'edge_devices'])
  })

  it('監査ログに消した件数を残す', async () => {
    await call('old')
    expect(h.audits).toEqual([expect.objectContaining({
      actorUserId: 'admin-1', action: 'edge.delete', targetType: 'edge', targetId: 'old', storeId: 'store-1',
      changes: { cameras: 2, alarm_events: 1, alarm_frames: 2 },
    })])
  })

  it('カメラが無いエッジは、発報の表に触れずに消す', async () => {
    fake.state.db.edge_devices.push({ id: 'empty' })
    const res = await call('empty')
    expect(res.status).toBe(200)
    expect(fake.state.deletes).toEqual(['edge_devices'])
  })

  it('発報の記録を消せなければエッジは消さず、理由を返す', async () => {
    fake.state.failOn = 'alarm_events'
    const res = await call('old')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alarm_purge_failed', message: 'alarm_events: alarm_events down' })
    expect(fake.state.db.edge_devices.map((e) => e.id)).toEqual(['old', 'live'])
    expect(h.audits).toEqual([])
  })

  it('エッジの削除が失敗したら、DB の文言を message で返す (画面に出す)', async () => {
    fake.state.failOn = 'edge_devices'
    const res = await call('old')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'delete_failed', message: 'edge_devices down' })
  })

  it('カメラが多くても in 句は 200 個ずつに分け、1,000 行を超えて読む', async () => {
    const many = Array.from({ length: 1234 }, (_, i) => `c-${String(i).padStart(5, '0')}`)
    fake.state.db.recorder_cameras.push(...many.map((id) => ({ id, recorder_id: 'r-old' })))
    fake.state.db.alarm_events.push({ id: 'a-last', camera_id: many[many.length - 1] })
    const res = await call('old')
    expect(res.status).toBe(200)
    expect(fake.state.maxIn).toBeLessThanOrEqual(200)
    expect(fake.state.db.alarm_events.map((a) => a.id)).toEqual(['a-live'])
    expect(h.audits[0]).toMatchObject({ changes: { cameras: 1236 } })
  })

  it('super_admin でなければ何も消さない', async () => {
    h.guard = { ok: false, status: 403, error: 'forbidden' }
    const res = await call('old')
    expect(res.status).toBe(403)
    expect(fake.state.deletes).toEqual([])
  })
})
