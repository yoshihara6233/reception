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

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  dispatched: [] as string[],
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
        const b = {
          select: () => b, eq: () => b, limit: () => b,
          maybeSingle: async () => ({ data: { id: 'edge-1' }, error: null }),
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
    dispatchAlarmTimeline: async (_s: unknown, _edge: string, alarmId: string) => {
      h.dispatched.push(alarmId)
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
})
