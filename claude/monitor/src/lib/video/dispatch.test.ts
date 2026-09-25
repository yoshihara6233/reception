import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/storage/video-r2', () => ({
  videoR2Configured: () => true,
  presignVideoUpload: async (sid: string, kind: string) => ({
    slots: Array.from({ length: kind === 'hls_vod' ? 16 : 8 }, (_, i) => `https://r2.example/video/${sid}/slot${i}?X-Amz-Signature=secret`),
    init: `https://r2.example/video/${sid}/init?X-Amz-Signature=secret`,
    playlist: `https://r2.example/video/${sid}/playlist?X-Amz-Signature=secret`,
    expires_at: 1,
  }),
}))

const lk = vi.hoisted(() => ({
  enabled: true,
  fail: false,
  created: [] as string[],
  deleted: [] as string[],
}))
vi.mock('@/lib/livekit', () => ({ livekitEnabled: () => lk.enabled }))
vi.mock('@/lib/livekit-server', () => ({
  createGvmsIngress: async (sid: string) => {
    if (lk.fail) throw new Error('quota')
    lk.created.push(sid)
    return { ingressId: `IN_${sid}`, room: `gvms_${sid}`, whipUrl: `https://lk.example/w/STREAMKEY-${sid}` }
  },
  deleteGvmsIngress: async (id: string) => { lk.deleted.push(id); return true },
}))

import { applyStartResult, nextVideoCommand } from './dispatch'

type Row = Record<string, unknown>

/** video_sessions / edge_command_runs だけを持つ、PostgREST の書き方に沿った小さな模擬 DB。 */
function fakeDb(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= [])
      const filters: ((r: Row) => boolean)[] = []
      let patch: Row | null = null
      let insertRow: Row | null = null
      let wantRows = true
      const b = {
        select() { wantRows = true; return b },
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return b },
        in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return b },
        is(col: string, v: unknown) { filters.push((r) => (r[col] ?? null) === v); return b },
        update(p: Row) { patch = p; return b },
        insert(r: Row) { insertRow = r; wantRows = false; return b },
        then(resolve: (v: { data: Row[] | null; error: null }) => void) {
          if (insertRow) { rows.push(insertRow); return resolve({ data: null, error: null }) }
          const hit = rows.filter((r) => filters.every((f) => f(r)))
          if (patch) for (const r of hit) Object.assign(r, patch)
          resolve({ data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null })
        },
      }
      return b
    },
  }
  return client as unknown as SupabaseClient
}

const EDGE = 'e0000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-10-01T01:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

function session(p: Row): Row {
  return {
    id: 's1', edge_id: EDGE, kind: 'hls_live', state: 'requested', camera_id: 'c1', stream: 'sub',
    vod_from: null, vod_to: null, user_id: 'u1', viewer_name: '山田 (本社)',
    viewer_seen_at: ago(1_000), stop_requested_at: null, refresh_sent_at: null, dispatched_at: null, ...p,
  }
}

let tables: Record<string, Row[]>
beforeEach(() => {
  tables = { video_sessions: [], edge_command_runs: [] }
  Object.assign(lk, { enabled: true, fail: false, created: [], deleted: [] })
})

describe('nextVideoCommand', () => {
  it('HLS ライブの開始（§5.2.1）: 置き場 8・viewer 付き。状態は dispatched に進む', async () => {
    tables.video_sessions.push(session({}))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({
      action: 'start_hls_live', session_id: 's1', camera_id: 'c1', stream: 'sub',
      viewer: { id: 'u1', name: '山田 (本社)' },
    })
    expect(cmd && 'upload' in cmd && cmd.upload.slots).toHaveLength(8)
    const s = tables.video_sessions[0]
    expect(s.state).toBe('dispatched')
    expect(s.start_request_id).toBe(cmd!.request_id)
    // 受領の記録には送り先（署名）を残さない
    expect(tables.edge_command_runs).toEqual([{ request_id: cmd!.request_id, edge_id: EDGE, action: 'start_hls_live' }])
    expect(JSON.stringify(tables)).not.toContain('Signature')
  })

  it('録画再生の開始（§5.3.1）: 置き場 16・from/to', async () => {
    tables.video_sessions.push(session({
      kind: 'hls_vod', vod_from: '2026-10-01T00:00:00+00:00', vod_to: '2026-10-01T00:30:00+00:00',
    }))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({
      action: 'start_hls_vod', from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T00:30:00.000Z',
    })
    expect(cmd && 'upload' in cmd && cmd.upload.slots).toHaveLength(16)
  })

  it('画面を閉じたら stop_video を渡し、クラウド側でも stopped にする', async () => {
    tables.video_sessions.push(session({ state: 'started', dispatched_at: ago(10_000), stop_requested_at: ago(100) }))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({ action: 'stop_video', session_id: 's1' })
    expect(tables.video_sessions[0].state).toBe('stopped')
  })

  it('渡す前に閉じたセッションは黙って落とし、次の指示へ進む', async () => {
    tables.video_sessions.push(
      session({ id: 'gone', stop_requested_at: ago(100) }),
      session({ id: 'next', viewer_seen_at: ago(500) }),
    )
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({ action: 'start_hls_live', session_id: 'next' })
    expect(tables.video_sessions.find((r) => r.id === 'gone')!.state).toBe('stopped')
  })

  it('合図は結果を返さないので受領の記録にも残さない', async () => {
    tables.video_sessions.push(session({ state: 'started', dispatched_at: ago(40_000) }))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({ action: 'refresh_video', session_id: 's1' })
    expect(tables.edge_command_runs).toHaveLength(0)
    expect(tables.video_sessions[0].refresh_sent_at).toBe(NOW.toISOString())
  })

  it('他拠点のセッションには触れない', async () => {
    tables.video_sessions.push(session({ edge_id: 'other' }))
    expect(await nextVideoCommand(fakeDb(tables), EDGE, NOW)).toBeNull()
    expect(tables.video_sessions[0].state).toBe('requested')
  })

  it('SFU: 受け口を作ってから start_sfu を渡す。部屋は視聴ごと・送り先 URL は DB と記録に残さない', async () => {
    tables.video_sessions.push(session({ kind: 'sfu' }))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({
      action: 'start_sfu', session_id: 's1', camera_id: 'c1', stream: 'sub', room: 'gvms_s1',
      whip_url: 'https://lk.example/w/STREAMKEY-s1', viewer: { id: 'u1', name: '山田 (本社)' },
    })
    expect(cmd).not.toHaveProperty('whip_bearer') // 自己認証 URL なので Bearer は使わない
    expect(tables.video_sessions[0]).toMatchObject({ state: 'dispatched', ingress_id: 'IN_s1', room: 'gvms_s1' })
    expect(JSON.stringify(tables)).not.toContain('STREAMKEY')
    expect(tables.edge_command_runs).toEqual([expect.objectContaining({ action: 'start_sfu' })])
  })

  it('SFU: LiveKit が無効・受け口を作れないときは失敗として閉じる（渡さない）', async () => {
    lk.enabled = false
    tables.video_sessions.push(session({ kind: 'sfu' }))
    expect(await nextVideoCommand(fakeDb(tables), EDGE, NOW)).toBeNull()
    expect(tables.video_sessions[0]).toMatchObject({ state: 'error', error: 'internal' })

    lk.enabled = true
    lk.fail = true
    tables.video_sessions.push(session({ id: 's2', kind: 'sfu' }))
    expect(await nextVideoCommand(fakeDb(tables), EDGE, NOW)).toBeNull()
    expect(tables.video_sessions[1]).toMatchObject({ state: 'error', error: 'internal' })
  })

  it('SFU: 止めるときに受け口も片付ける（§5.4.1）', async () => {
    tables.video_sessions.push(session({
      kind: 'sfu', state: 'started', ingress_id: 'IN_s1', room: 'gvms_s1', stop_requested_at: ago(500),
    }))
    const cmd = await nextVideoCommand(fakeDb(tables), EDGE, NOW)
    expect(cmd).toMatchObject({ action: 'stop_video', session_id: 's1' })
    expect(lk.deleted).toEqual(['IN_s1'])
    expect(tables.video_sessions[0]).toMatchObject({ state: 'stopped', purged_at: NOW.toISOString() })
  })
})

describe('applyStartResult（commands/result）', () => {
  it('ok なら started', async () => {
    tables.video_sessions.push(session({ state: 'dispatched', start_request_id: 'r1' }))
    await applyStartResult(fakeDb(tables), EDGE, 'r1', true, null)
    expect(tables.video_sessions[0].state).toBe('started')
  })

  it('ok:false なら error と値（画面の戻り先を決める）', async () => {
    tables.video_sessions.push(session({ state: 'dispatched', start_request_id: 'r1' }))
    await applyStartResult(fakeDb(tables), EDGE, 'r1', false, 'busy')
    expect(tables.video_sessions[0]).toMatchObject({ state: 'error', error: 'busy' })
  })

  it('他拠点からの結果では書き換えない', async () => {
    tables.video_sessions.push(session({ state: 'dispatched', start_request_id: 'r1' }))
    await applyStartResult(fakeDb(tables), 'other', 'r1', false, 'busy')
    expect(tables.video_sessions[0].state).toBe('dispatched')
  })
})
