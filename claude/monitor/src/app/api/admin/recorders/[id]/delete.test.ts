import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createAlarmFkDb, seedTwoEdges } from '@/test/fake-alarm-fk-db'

/**
 * レコーダの削除 (DELETE /api/admin/recorders/[id]) と、カメラ一覧の保存での削除
 * (PUT /api/admin/recorders/[id]/cameras の delete) が、発報の記録が残っていても通ることを固定する (2026-10-16)。
 *
 * エッジ削除と同じ原因 (alarm_events / alarm_frames の camera_id が NO ACTION) で 500 になっていた。
 * 消し方はエッジ削除と共通 (lib/admin/alarm-purge.ts)。外部キーは src/test/fake-alarm-fk-db.ts で再現する。
 */

const h = vi.hoisted(() => ({
  guard: null as unknown,
  audits: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin/guard', () => ({ requireAdmin: async () => h.guard }))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_s: unknown, e: Record<string, unknown>) => { h.audits.push(e) },
  storeIdForRecorder: async () => 'store-1',
}))

import { DELETE } from './route'
import { PUT } from './cameras/route'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const del = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/admin/recorders/${id}`, { method: 'DELETE' }), ctx(id))
const putCams = (id: string, body: unknown) =>
  PUT(new NextRequest(`http://localhost/api/admin/recorders/${id}/cameras`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), ctx(id))

// zod の uuid() を通すため、カメラの id は uuid の形にする
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let fake: ReturnType<typeof createAlarmFkDb>

beforeEach(() => {
  fake = createAlarmFkDb(seedTwoEdges())
  h.guard = { ok: true, user: { id: 'admin-1' }, supa: fake.client }
  h.audits = []
})

describe('DELETE /api/admin/recorders/[id]', () => {
  it('発報の記録が残っていても、先に消してからレコーダを消す', async () => {
    const res = await del('r-old')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: { cameras: 2, alarm_events: 1, alarm_frames: 2 } })

    const db = fake.state.db
    expect(db.recorders.map((r) => r.id)).toEqual(['r-live'])
    expect(db.recorder_cameras.map((c) => c.id)).toEqual(['c-live-1'])
    expect(db.alarm_events.map((a) => a.id)).toEqual(['a-live'])
    expect(db.alarm_frames.map((f) => f.id)).toEqual(['f-live'])
    // エッジは消さない
    expect(db.edge_devices.map((e) => e.id)).toEqual(['old', 'live'])
    expect(fake.state.deletes).toEqual(['alarm_frames', 'alarm_events', 'recorders'])
  })

  it('監査ログに消した件数を残す (エッジ削除と同じ形)', async () => {
    await del('r-old')
    expect(h.audits).toEqual([expect.objectContaining({
      action: 'recorder.delete', targetType: 'recorder', targetId: 'r-old', storeId: 'store-1',
      changes: { cameras: 2, alarm_events: 1, alarm_frames: 2 },
    })])
  })

  it('発報の記録を消せなければレコーダは消さず、理由を返す', async () => {
    fake.state.failOn = 'alarm_frames'
    const res = await del('r-old')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alarm_purge_failed', message: 'alarm_frames: alarm_frames down' })
    expect(fake.state.db.recorders.map((r) => r.id)).toEqual(['r-old', 'r-live'])
    expect(h.audits).toEqual([])
  })

  it('レコーダの削除が失敗したら、DB の文言は返さず db_error を返す (中身はサーバのログ・ASVS 16.5.1)', async () => {
    fake.state.failOn = 'recorders'
    const res = await del('r-old')
    expect(res.status).toBe(500)
    // 配下のカメラの一覧は recorder_cameras から読むので、発報の記録は先に消えている
    expect(await res.json()).toEqual({ error: 'delete_failed', message: 'db_error' })
  })
})

describe('PUT /api/admin/recorders/[id]/cameras の削除', () => {
  beforeEach(() => {
    const db = fake.state.db
    db.recorder_cameras = [
      { id: U(1), recorder_id: 'r-old' },
      { id: U(2), recorder_id: 'r-old' },
      { id: U(9), recorder_id: 'r-live' },
    ]
    db.alarm_events = [{ id: 'a1', camera_id: U(1) }, { id: 'a2', camera_id: U(2) }, { id: 'a9', camera_id: U(9) }]
    db.alarm_frames = [
      { id: 'f1', alarm_event_id: 'a1', camera_id: U(1) },
      { id: 'f2', alarm_event_id: 'a2', camera_id: U(2) },
      { id: 'f9', alarm_event_id: 'a9', camera_id: U(9) },
    ]
  })

  it('消すカメラの発報の記録だけを先に消し、カメラを消す', async () => {
    const res = await putCams('r-old', { delete: [U(1)] })
    expect(res.status).toBe(200)
    const db = fake.state.db
    expect(db.recorder_cameras.map((c) => c.id)).toEqual([U(2), U(9)])
    expect(db.alarm_events.map((a) => a.id)).toEqual(['a2', 'a9'])
    expect(db.alarm_frames.map((f) => f.id)).toEqual(['f2', 'f9'])
    expect(fake.state.deletes).toEqual(['alarm_frames', 'alarm_events', 'recorder_cameras'])
    expect(h.audits).toEqual([expect.objectContaining({
      action: 'recorder.cameras', targetId: 'r-old',
      changes: expect.objectContaining({ deleted: [U(1)], alarm_events: 1, alarm_frames: 1 }),
    })])
  })

  it('ほかのレコーダのカメラの id を混ぜても、その発報の記録は消さない', async () => {
    // U(9) は r-live のカメラ。r-old への要求では対象外 (カメラ自体も消えない)
    const res = await putCams('r-old', { delete: [U(1), U(9)] })
    expect(res.status).toBe(200)
    const db = fake.state.db
    expect(db.alarm_events.map((a) => a.id)).toEqual(['a2', 'a9'])
    expect(db.recorder_cameras.map((c) => c.id)).toEqual([U(2), U(9)])
  })

  it('発報の記録を消せなければカメラは消さず、理由を返す', async () => {
    fake.state.failOn = 'alarm_events'
    const res = await putCams('r-old', { delete: [U(1)] })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alarm_purge_failed', message: 'alarm_events: alarm_events down' })
    expect(fake.state.db.recorder_cameras.map((c) => c.id)).toEqual([U(1), U(2), U(9)])
    expect(h.audits).toEqual([])
  })

  it('削除が無ければ発報の表に触れない', async () => {
    const res = await putCams('r-old', { delete: [] })
    expect(res.status).toBe(200)
    expect(fake.state.deletes).toEqual([])
  })
})
