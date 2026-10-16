import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * エッジ削除 (DELETE /api/admin/edges/[id]) が、発報の記録が残っていても通ることを固定する (2026-10-16)。
 *
 * alarm_events.camera_id と alarm_frames.camera_id は recorder_cameras を ON DELETE の
 * 指定なしで参照している。以前のルートは edge_devices を消すだけだったので、旧エッジの
 * カメラに発報の記録が残っていると外部キー違反で 500 になっていた (拠点「PoC 熊本店」)。
 *
 * DB は外に出さず、モックの側で外部キーを再現する:
 *   - edge_devices → recorders → recorder_cameras は CASCADE
 *   - alarm_frames.alarm_event_id → alarm_events は CASCADE
 *   - alarm_events / alarm_frames の camera_id → recorder_cameras は NO ACTION (残っていれば失敗)
 */

type Row = Record<string, string | null>
type Db = Record<string, Row[]>

const h = vi.hoisted(() => ({
  db: {} as Db,
  guard: null as unknown,
  audits: [] as Record<string, unknown>[],
  /** 実行した削除の順番 (表名) */
  deletes: [] as string[],
  /** in 句に並べた id の数の最大 */
  maxIn: 0,
  failOn: null as string | null,
}))

function camerasOfEdge(db: Db, edgeId: string): Set<string> {
  const recs = new Set(db.recorders.filter((r) => r.edge_id === edgeId).map((r) => r.id))
  return new Set(db.recorder_cameras.filter((c) => recs.has(c.recorder_id)).map((c) => c.id as string))
}

function fakeSupa() {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = []
      let mode: 'select' | 'delete' = 'select'
      let range: [number, number] | null = null
      let wantCount = false
      const run = () => {
        if (h.failOn === table) return { data: null, error: { message: `${table} down` }, count: null }
        const all = h.db[table] ?? []
        const hit = all.filter((r) => filters.every((f) => f(r)))
        if (mode === 'select') {
          let out = [...hit].sort((a, b) => String(a.id).localeCompare(String(b.id)))
          if (range) out = out.slice(range[0], range[1] + 1)
          return { data: out.map((r) => ({ id: r.id })), error: null }
        }
        h.deletes.push(table)
        if (table === 'edge_devices') {
          for (const e of hit) {
            const cams = camerasOfEdge(h.db, e.id as string)
            const blocked = h.db.alarm_events.some((a) => cams.has(a.camera_id as string))
              || h.db.alarm_frames.some((f) => cams.has(f.camera_id as string))
            if (blocked) {
              return { data: null, count: null, error: { message: 'update or delete on table "recorder_cameras" violates foreign key constraint "alarm_events_camera_id_fkey"' } }
            }
            const recs = new Set(h.db.recorders.filter((r) => r.edge_id === e.id).map((r) => r.id))
            h.db.recorder_cameras = h.db.recorder_cameras.filter((c) => !cams.has(c.id as string))
            h.db.recorders = h.db.recorders.filter((r) => !recs.has(r.id))
          }
        }
        if (table === 'alarm_events') {
          const gone = new Set(hit.map((a) => a.id))
          h.db.alarm_frames = h.db.alarm_frames.filter((f) => !gone.has(f.alarm_event_id))
        }
        h.db[table] = all.filter((r) => !hit.includes(r))
        return { data: null, error: null, count: wantCount ? hit.length : null }
      }
      const b = {
        select() { mode = 'select'; return b },
        delete(o?: { count?: string }) { mode = 'delete'; wantCount = !!o?.count; return b },
        eq(col: string, v: string) { filters.push((r) => r[col] === v); return b },
        in(col: string, vs: string[]) { h.maxIn = Math.max(h.maxIn, vs.length); filters.push((r) => vs.includes(r[col] as string)); return b },
        order() { return b },
        range(a: number, z: number) { range = [a, z]; return b },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve().then(run).then(res, rej)
        },
      }
      return b
    },
  }
}

vi.mock('@/lib/admin/guard', () => ({ requireSuperAdmin: async () => h.guard }))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_s: unknown, e: Record<string, unknown>) => { h.audits.push(e) },
  storeIdForEdge: async () => 'store-1',
}))

import { DELETE } from './route'

const call = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/admin/edges/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) })

describe('DELETE /api/admin/edges/[id]', () => {
  beforeEach(() => {
    h.guard = { ok: true, user: { id: 'admin-1' }, supa: fakeSupa() }
    h.audits = []
    h.deletes = []
    h.maxIn = 0
    h.failOn = null
    h.db = {
      edge_devices: [{ id: 'old' }, { id: 'live' }],
      recorders: [{ id: 'r-old', edge_id: 'old' }, { id: 'r-live', edge_id: 'live' }],
      recorder_cameras: [
        { id: 'c-old-1', recorder_id: 'r-old' },
        { id: 'c-old-2', recorder_id: 'r-old' },
        { id: 'c-live-1', recorder_id: 'r-live' },
      ],
      alarm_events: [
        { id: 'a-old', camera_id: 'c-old-1' },
        { id: 'a-live', camera_id: 'c-live-1' },
      ],
      alarm_frames: [
        { id: 'f-old', alarm_event_id: 'a-old', camera_id: 'c-old-1' },
        // 旧エッジのカメラのコマが、動いているエッジの発報に付いている (camera_id の NO ACTION で止まる形)
        { id: 'f-cross', alarm_event_id: 'a-live', camera_id: 'c-old-2' },
        { id: 'f-live', alarm_event_id: 'a-live', camera_id: 'c-live-1' },
      ],
    }
  })

  it('発報の記録が残っていても、先に消してからエッジを消す', async () => {
    const res = await call('old')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: { alarm_events: 1, alarm_frames: 2 } })

    expect(h.db.edge_devices.map((e) => e.id)).toEqual(['live'])
    expect(h.db.alarm_events.map((a) => a.id)).toEqual(['a-live'])
    expect(h.db.alarm_frames.map((f) => f.id)).toEqual(['f-live'])
    // ほかのエッジのカメラ・レコーダには触れない
    expect(h.db.recorder_cameras.map((c) => c.id)).toEqual(['c-live-1'])
    // 消す順番: コマ → 発報 → エッジ
    expect(h.deletes).toEqual(['alarm_frames', 'alarm_events', 'edge_devices'])
  })

  it('監査ログに消した件数を残す', async () => {
    await call('old')
    expect(h.audits).toEqual([expect.objectContaining({
      actorUserId: 'admin-1', action: 'edge.delete', targetType: 'edge', targetId: 'old', storeId: 'store-1',
      changes: { cameras: 2, alarm_events: 1, alarm_frames: 2 },
    })])
  })

  it('カメラが無いエッジは、発報の表に触れずに消す', async () => {
    h.db.edge_devices.push({ id: 'empty' })
    const res = await call('empty')
    expect(res.status).toBe(200)
    expect(h.deletes).toEqual(['edge_devices'])
  })

  it('発報の記録を消せなければエッジは消さず、理由を返す', async () => {
    h.failOn = 'alarm_events'
    const res = await call('old')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alarm_purge_failed', message: 'alarm_events: alarm_events down' })
    expect(h.db.edge_devices.map((e) => e.id)).toEqual(['old', 'live'])
    expect(h.audits).toEqual([])
  })

  it('エッジの削除が失敗したら、DB の文言を message で返す (画面に出す)', async () => {
    h.failOn = 'edge_devices'
    const res = await call('old')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'delete_failed', message: 'edge_devices down' })
  })

  it('カメラが多くても in 句は 200 個ずつに分け、1,000 行を超えて読む', async () => {
    const many = Array.from({ length: 1234 }, (_, i) => `c-${String(i).padStart(5, '0')}`)
    h.db.recorder_cameras.push(...many.map((id) => ({ id, recorder_id: 'r-old' })))
    h.db.alarm_events.push({ id: 'a-last', camera_id: many[many.length - 1] })
    const res = await call('old')
    expect(res.status).toBe(200)
    expect(h.maxIn).toBeLessThanOrEqual(200)
    expect(h.db.alarm_events.map((a) => a.id)).toEqual(['a-live'])
    expect(h.audits[0]).toMatchObject({ changes: { cameras: 1236 } })
  })

  it('super_admin でなければ何も消さない', async () => {
    h.guard = { ok: false, status: 403, error: 'forbidden' }
    const res = await call('old')
    expect(res.status).toBe(403)
    expect(h.deletes).toEqual([])
  })
})
