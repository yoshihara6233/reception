import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'
import { cleanPayload, parseHeader, usageRetentionCutoff } from '@/lib/edge-usage/report'

/**
 * 現場の受け口 POST /api/edge/usage（GVMS_CLOUD_SPEC §12.4・D-2-22）。
 *
 * 守りたい性質:
 *   ① 約款の施行前（GVMS_USAGE_INTAKE が on でない）は、テナントの設定に関わらず 409 usage_disabled
 *   ② テナントが止めていれば 409 usage_disabled
 *   ③ 1 拠点 1 日 1 行・同じ日の送り直しは上書き
 *   ④ 知らない項目と形の合わない値は捨てて保存する（拒否しない）。日と版が読めないときだけ 400
 *   ⑤ 64 KB を超えたら 413
 */

const EDGE = { id: 'edge-1', store_id: 'store-1' }

const h = vi.hoisted(() => ({
  edge: null as { id: string; store_id: string } | null,
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
}))

vi.mock('@/lib/edge/device-auth', () => ({ authenticateEdge: async () => h.edge }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => h.db.client }))

import { POST } from './route'

function jstToday(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
}

function report(over: Record<string, unknown> = {}) {
  return {
    day: jstToday(-1), agent_version: 'nvmsd/0.1.184', schema: 1,
    features: { 'screen.live': 412, 'live.split.16': 120, export: 2 },
    errors: { 'ingest.restart': 3, 'rec.gap_seconds': 0, 'live.webrtc_fallback_ratio': 0.04 },
    cameras: [{ vendor: 'AXIS', model: 'M3116-LVE', firmware: '11.11', codec: 'h265', res: '1280x720', fps: 15, gop: 'le2s', audio: false, count: 250 }],
    load: { cameras: 250, nodes: 1, cpu_avg: 0.22, cpu_max: 0.41, mem_gb_max: 8.1, disk_used_ratio: 0.12, rec_gb: 410 },
    clients: { browsers: { chrome: 9, edge: 2 }, os: { windows: 11 }, widths: { lt1920: 11 }, max_concurrent: 3 },
    doctor: { ok: 14, warn: 1, fail: 0 },
    ...over,
  }
}

const post = (b: unknown) => POST(new NextRequest('http://localhost/api/edge/usage', {
  method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b), headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
}))

function seed(usageEnabled = true) {
  h.db = createFakeDb({
    stores: [{ id: 'store-1', tenant_id: 'tenant-1', name: '本店' }],
    tenants: [{ id: 'tenant-1', name: 'テナントA', usage_enabled: usageEnabled }],
    edge_usage_reports: [],
  }, { uniques: { edge_usage_reports: [['edge_id', 'day']] } })
}

beforeEach(() => {
  h.edge = EDGE
  process.env.GVMS_USAGE_INTAKE = 'on'
  seed()
})
afterEach(() => { delete process.env.GVMS_USAGE_INTAKE })

describe('POST /api/edge/usage', () => {
  it('① 約款の施行前 (GVMS_USAGE_INTAKE が on でない) は保存せずに 409', async () => {
    delete process.env.GVMS_USAGE_INTAKE
    const res = await post(report())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'usage_disabled' })
    expect(h.db.rows('edge_usage_reports')).toHaveLength(0)
  })

  it('② テナントが止めていれば 409', async () => {
    seed(false)
    const res = await post(report())
    expect(res.status).toBe(409)
    expect(h.db.rows('edge_usage_reports')).toHaveLength(0)
  })

  it('③ 204 で保存し、同じ日の送り直しは上書きする', async () => {
    expect((await post(report())).status).toBe(204)
    expect((await post(report({ features: { 'screen.live': 500 } }))).status).toBe(204)
    const rows = h.db.rows('edge_usage_reports')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tenant_id: 'tenant-1', store_id: 'store-1', edge_id: 'edge-1', day: jstToday(-1), schema: 1, agent_version: 'nvmsd/0.1.184' })
    expect((rows[0].payload as { features: Record<string, number> }).features).toEqual({ 'screen.live': 500 })
  })

  it('④ 知らない項目と形の合わない値は捨てて受ける', async () => {
    const res = await post(report({
      camera_names: ['正面玄関'], // 知らない項目
      features: { 'screen.live': 3, 'screen.192.168.0.10 正面': 1, export: -1, ptz: 'x' },
      cameras: [{ vendor: 'AXIS<script>', model: 'M3116-LVE', codec: 'mjpeg', res: '1280*720', fps: 15, gop: 'forever', audio: 'yes', count: 2, name: '正面' }],
      load: { cameras: 2, cpu_avg: 0.3, hostname: 'nvr-01' },
    }))
    expect(res.status).toBe(204)
    const p = h.db.rows('edge_usage_reports')[0].payload as Record<string, unknown>
    expect(JSON.stringify(p)).not.toMatch(/正面|192\.168|nvr-01|script/)
    expect(p.features).toEqual({ 'screen.live': 3 })
    expect(p.cameras).toEqual([{ vendor: '', model: 'M3116-LVE', firmware: '', codec: '', res: '', fps: 15, gop: '', audio: false, count: 2 }])
    expect(p.load).toEqual({ cameras: 2, cpu_avg: 0.3 })
  })

  it('④ 日と版が読めない・日が古すぎる/未来なら 400', async () => {
    expect((await post(report({ day: 'yesterday' }))).status).toBe(400)
    expect((await post(report({ schema: 0 }))).status).toBe(400)
    expect((await post(report({ day: jstToday(-40) }))).status).toBe(400)
    expect((await post(report({ day: jstToday(1) }))).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect(h.db.rows('edge_usage_reports')).toHaveLength(0)
  })

  it('⑤ 64 KB を超えたら 413', async () => {
    const big = report({ features: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`screen.x${i}`, i])) })
    expect((await post(big)).status).toBe(413)
  })

  it('トークンが違えば 401', async () => {
    h.edge = null
    expect((await post(report())).status).toBe(401)
  })
})

describe('lib/edge-usage/report', () => {
  it('parseHeader は今日 (日本時間) までを受ける', () => {
    expect(parseHeader({ day: jstToday(0), schema: 1 })?.day).toBe(jstToday(0))
    expect(parseHeader({ day: jstToday(-31), schema: 1 })).not.toBeNull()
    expect(parseHeader({ day: jstToday(-32), schema: 1 })).toBeNull()
  })
  it('cleanPayload は空の本文でも形をそろえる', () => {
    expect(cleanPayload({})).toEqual({
      features: {}, errors: {}, cameras: [], load: {},
      clients: { browsers: {}, os: {}, widths: {}, max_concurrent: 0 }, doctor: { ok: 0, warn: 0, fail: 0 },
    })
  })
  it('usageRetentionCutoff は 25 か月前', () => {
    expect(usageRetentionCutoff(new Date('2026-10-22T00:00:00Z'))).toBe('2024-09-22')
  })
})
