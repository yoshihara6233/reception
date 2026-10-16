import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 発報の拾い直し cron が、**G・VMS の重大イベント (source='nvms') に前後スナップの指示を出さない**
 * ことを、ハンドラを呼んで確かめる。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * G・VMS の重大イベントはカメラの発報ではなく (camera_id は null)、G・VMS は
 * capture_alarm_timeline に対応していないので読み飛ばす。以前はこの cron が出どころを見ずに
 * 指示を送り、「送信済みなのに前後スナップが無い」として証跡の点検が欠落に数えていた
 * (2026-09-26 に .200 の再起動で 6 件・誤った警報)。
 *
 * DB は外に出さず、問い合わせの条件をモックの側で**実際に当てて**、条件の書き方の誤り
 * (PostgREST の in 句の形など) も拾えるようにする。
 */

type Row = { id: string; store_id: string | null; occurred_at: string; source: string; timeline_dispatched_at: string | null }

type EdgeRow = { id: string; store_id: string; last_seen_at: string | null }

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  edges: [] as EdgeRow[],
  dispatched: [] as string[],
  /** 指示を投入したエッジ (発報 id → エッジ id) */
  dispatchedTo: {} as Record<string, string>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: (table: string) => {
      if (table === 'alarm_events') {
        let rows = [...h.rows]
        const b = {
          select: () => b,
          is: (col: keyof Row, v: null) => { rows = rows.filter((r) => r[col] === v); return b },
          not: (col: keyof Row, op: string, v: string) => {
            expect(op).toBe('in')
            const list = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim())
            rows = rows.filter((r) => !list.includes(String(r[col])))
            return b
          },
          gte: (col: keyof Row, v: string) => { rows = rows.filter((r) => String(r[col]) >= v); return b },
          order: () => b,
          limit: async () => ({ data: rows, error: null }),
        }
        return b
      }
      if (table === 'edge_devices') {
        let rows = [...h.edges]
        const b = {
          select: () => b,
          eq: (col: keyof EdgeRow, v: string) => { rows = rows.filter((r) => r[col] === v); return b },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(res, rej),
        }
        return b
      }
      throw new Error(`想定外の表: ${table}`)
    },
  }),
}))

vi.mock('@/lib/alarms/dispatch', async (orig) => {
  const real = await orig<typeof import('@/lib/alarms/dispatch')>()
  return {
    ...real,
    dispatchAlarmTimeline: async (_s: unknown, edgeId: string, alarmId: string) => {
      h.dispatched.push(alarmId)
      h.dispatchedTo[alarmId] = edgeId
      return true
    },
  }
})

import { GET } from '@/app/api/cron/alarm-dispatch-retry/route'
import { NextRequest } from 'next/server'

const call = () => GET(new NextRequest('http://localhost/api/cron/alarm-dispatch-retry', {
  headers: { authorization: 'Bearer test-secret' },
}))

describe('alarm-dispatch-retry', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    const now = new Date().toISOString()
    h.dispatched = []
    h.dispatchedTo = {}
    h.edges = [{ id: 'edge-1', store_id: 's1', last_seen_at: now }]
    h.rows = [
      { id: 'cam-alarm', store_id: 's1', occurred_at: now, source: 'onvif', timeline_dispatched_at: null },
      { id: 'gvms-event', store_id: 's1', occurred_at: now, source: 'nvms', timeline_dispatched_at: null },
      { id: 'webhook-alarm', store_id: 's1', occurred_at: now, source: 'webhook', timeline_dispatched_at: null },
    ]
  })

  it('G・VMS の重大イベント (nvms) には前後スナップの指示を出さない', async () => {
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(h.dispatched).toEqual(['cam-alarm', 'webhook-alarm'])
    expect(h.dispatched).not.toContain('gvms-event')
    expect(body).toMatchObject({ ok: true, pending: 2, dispatched: 2 })
  })

  it('G・VMS の重大イベントだけなら何も送らない', async () => {
    h.rows = h.rows.filter((r) => r.source === 'nvms')
    const body = await (await call()).json()
    expect(h.dispatched).toEqual([])
    expect(body).toMatchObject({ ok: true, pending: 0, dispatched: 0 })
  })

  // 2026-10-16: 拠点に止まった旧エッジと動いているエッジの 2 台があると、順序指定なしの
  // limit(1) では止まった方に投入されることがあった。最後に通知が届いたエッジへ送る。
  it('エッジが複数ある拠点では、最後に通知が届いたエッジへ投入する', async () => {
    h.rows = h.rows.filter((r) => r.id === 'cam-alarm')
    h.edges = [
      { id: 'edge-old', store_id: 's1', last_seen_at: '2026-09-01T00:00:00Z' },
      { id: 'edge-live', store_id: 's1', last_seen_at: new Date().toISOString() },
    ]
    await call()
    expect(h.dispatchedTo).toEqual({ 'cam-alarm': 'edge-live' })
  })

  it('拠点にエッジが無ければ送らない', async () => {
    h.edges = []
    const body = await (await call()).json()
    expect(h.dispatched).toEqual([])
    expect(body).toMatchObject({ ok: true, dispatched: 0 })
  })
})
