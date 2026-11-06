import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  /** 名乗りの列が無い DB（migration 前）を真似る */
  noAnnounceColumns: false,
  /** OS の脆弱性の列だけが無い DB（§13 の migration 前）を真似る */
  noOsVulnColumns: false,
}))

vi.mock('@/lib/edge/device-auth', () => ({
  authenticateEdge: async () => ({ id: 'edge-1', store_id: 'store-1' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: () => ({
      update: (p: Record<string, unknown>) => {
        h.updates.push(p)
        const missingOs = (h.noOsVulnColumns || h.noAnnounceColumns) && 'os_vuln' in p
        const missing = h.noAnnounceColumns && 'capabilities' in p
        const col = missingOs ? 'os_vuln' : 'capabilities'
        return { eq: async () => ({ error: missingOs || missing ? { code: 'PGRST204', message: `Could not find the '${col}' column` } : null }) }
      },
    }),
  }),
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/edge/heartbeat', {
  method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t' },
}))

beforeEach(() => { h.updates = []; h.noAnnounceColumns = false; h.noOsVulnColumns = false })

describe('POST /api/edge/heartbeat — 版と機能の名乗り（GVMS_CLOUD_SPEC §2）', () => {
  it('名乗りと遠隔視聴の状況を写す', async () => {
    const res = await post({
      status: 'idle', agent_version: 'nvmsd/0.1.68', spec_version: 1,
      capabilities: ['grid', 'hls_live', 'hls_vod'], video: { sessions: 2, kbps: 1650 },
    })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({
      spec_version: 1, capabilities: ['grid', 'hls_live', 'hls_vod'], video_sessions_now: 2, video_kbps: 1650,
    })
  })

  it('★知らない機能名を名乗っても拒否しない（§7-7）', async () => {
    const res = await post({ status: 'idle', capabilities: ['grid', 'teleport_v9'] })
    expect(res.status).toBe(204)
    expect(h.updates[0].capabilities).toEqual(['grid', 'teleport_v9'])
  })

  it('★名乗りが崩れていても死活は落とさない（読めた分だけ使う）', async () => {
    const res = await post({ status: 'idle', spec_version: 'v1', capabilities: ['ok', 42, 'NG!'], video: 'x' })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({ spec_version: null, capabilities: ['ok'], video_sessions_now: 0 })
    expect(h.updates[0].last_seen_at).toBeTruthy()
  })

  it('名乗りの無い拠点（0.1.67 以前へ戻した場合も）は null に戻す', async () => {
    await post({ status: 'idle', agent_version: 'nvmsd/0.1.67' })
    expect(h.updates[0]).toMatchObject({ spec_version: null, capabilities: null })
  })

  it('★名乗りの列がまだ無い DB でも死活は落とさない（migration 前のデプロイ）', async () => {
    h.noAnnounceColumns = true
    const res = await post({ status: 'idle', agent_version: 'nvmsd/0.1.68', capabilities: ['hls_live'] })
    expect(res.status).toBe(204)
    // os_vuln の列 → 名乗りの列 → 従来の列だけ、の順に書き直す
    expect(h.updates).toHaveLength(3)
    expect(h.updates[2]).not.toHaveProperty('capabilities')
    expect(h.updates[2]).toMatchObject({ status: 'idle', agent_version: 'nvmsd/0.1.68' })
  })

  it('★ログインの一本化 (§9) のクライアントの同期に失敗しても死活は落とさない', async () => {
    // この試験の偽のクライアントには gvms_oidc_clients の読み取りが無い (= 同期が例外になる)
    const res = await post({
      status: 'idle', capabilities: ['grid', 'oidc'],
      oidc_redirect_uris: ['https://192.168.0.200:8443/api/v1/auth/oidc/callback'],
    })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({ status: 'idle', capabilities: ['grid', 'oidc'] })
  })
})

describe('POST /api/edge/heartbeat — OS の既知の脆弱性の申告（GVMS_CLOUD_SPEC §13）', () => {
  const os = {
    table_version: 1, urgent: 1, routine: 0,
    servers: [{ node: 'node201', kernel: '5.14.0-687.10.1.el9_8.0.1', table_version: 1, urgent: 1, routine: 0, deferred: 0,
      findings: [{ id: 'GVMS-SA-2026-001', cve: 'CVE-2026-98432', package: 'kernel', level: 'urgent', fixed: '5.14.0-687.64.1.el9_8', installed: '5.14.0-687.10.1.el9_8.0.1' }] }],
  }

  it('申告を写し、合計を列にも置く', async () => {
    const res = await post({ status: 'idle', capabilities: ['grid', 'os_vuln'], os_vuln: os })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({ os_vuln_urgent: 1, os_vuln_routine: 0 })
    expect((h.updates[0].os_vuln as { servers: unknown[] }).servers).toHaveLength(1)
    expect(h.updates[0].os_vuln_reported_at).toBeTruthy()
  })

  it('申告が無ければ空に戻す（版を戻した拠点に古い申告を出さない）', async () => {
    await post({ status: 'idle' })
    expect(h.updates[0]).toMatchObject({ os_vuln: null, os_vuln_urgent: 0, os_vuln_routine: 0, os_vuln_reported_at: null })
  })

  it('★形が崩れた申告でも死活は落とさない', async () => {
    const res = await post({ status: 'idle', os_vuln: 'broken' })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({ os_vuln: null, os_vuln_urgent: 0 })
  })

  it('★OS の脆弱性の列がまだ無い DB でも、名乗りは残して書き直す', async () => {
    h.noOsVulnColumns = true
    const res = await post({ status: 'idle', capabilities: ['os_vuln'], os_vuln: os })
    expect(res.status).toBe(204)
    expect(h.updates).toHaveLength(2)
    expect(h.updates[1]).not.toHaveProperty('os_vuln')
    expect(h.updates[1]).toMatchObject({ capabilities: ['os_vuln'] })
  })
})
