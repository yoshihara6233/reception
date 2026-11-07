import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ARCHIVE_TABLES, dayPrefix, runAuditArchive, type ArchiveStore, type Manifest } from './archive'

/**
 * 監査の記録の書き出し (ASVS 16.4.3)。
 *   ★前の日までを書き、今日は書かない
 *   ★manifest は前の日の manifest の SHA-256 でつながる
 *   ★置き場にある物は上書きしない (2 回目は present)
 *   ★manifest の前で止まった日は、置き場にあるファイルを正として manifest を書く
 *   ★失敗した日で止め、後ろの日は次の実行に回す
 *   ★あとからさかのぼると、鎖の先頭だった日に link.json を書いて前の日とつなぐ
 */

type Row = Record<string, unknown> & { id: string }

/** from().select().gte().lt().order().range() だけを持つ偽の DB */
function fakeDb(tables: Record<string, Row[]>, failTable?: string): SupabaseClient {
  return {
    from(table: string) {
      const col = ARCHIVE_TABLES.find((t) => t.table === table)!.timeColumn
      let from = '', to = '', lo = 0, hi = 0
      const q = {
        select: () => q,
        gte: (_c: string, v: string) => ((from = v), q),
        lt: (_c: string, v: string) => ((to = v), q),
        order: () => q,
        range: (a: number, b: number) => {
          lo = a; hi = b
          if (table === failTable) return Promise.resolve({ data: null, error: { message: 'boom' } })
          const rows = (tables[table] ?? [])
            .filter((r) => (r[col] as string) >= from && (r[col] as string) < to)
            .sort((x, y) => x.id.localeCompare(y.id))
            .slice(lo, hi + 1)
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return q
    },
  } as unknown as SupabaseClient
}

function memStore(): ArchiveStore & { m: Map<string, Buffer>; puts: string[] } {
  const m = new Map<string, Buffer>()
  const puts: string[] = []
  return {
    m, puts,
    get: async (k) => m.get(k) ?? null,
    putOnce: async (k, b) => {
      if (m.has(k)) return 'exists'
      m.set(k, b); puts.push(k)
      return 'created'
    },
  }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const manifest = (s: ReturnType<typeof memStore>, d: string) => JSON.parse(s.m.get(`${dayPrefix(d)}/manifest.json`)!.toString()) as Manifest

const data: Record<string, Row[]> = {
  admin_audit_log: [
    { id: '1', ts: '2026-11-04T10:00:00Z', action: 'user.create' },
    { id: '2', ts: '2026-11-05T23:59:59Z', action: 'user.delete' },
    { id: '3', ts: '2026-11-06T00:00:01Z', action: 'today' },
  ],
  live_sessions: [{ id: 'a', started_at: '2026-11-05T01:00:00Z' }],
  video_sessions: [],
  footage_access_log: [{ id: 'f', accessed_at: '2026-11-04T05:00:00Z' }],
}
const now = new Date('2026-11-06T04:00:00Z')

describe('runAuditArchive', () => {
  it('★前の日までを日ごとに書き、manifest を前の日の SHA-256 でつなぐ', async () => {
    const s = memStore()
    const r = await runAuditArchive(fakeDb(data), s, { now, days: 2 })
    expect(r.ok).toBe(true)
    expect(r.days.map((d) => [d.date, d.status, d.rows])).toEqual([
      ['2026-11-04', 'exported', 2],
      ['2026-11-05', 'exported', 2],
    ])
    // 今日 (11/06) の行は出さない
    expect([...s.m.keys()].some((k) => k.includes('2026/11/06'))).toBe(false)
    const lines = gunzipSync(s.m.get('audit/v1/2026/11/05/admin_audit_log.jsonl.gz')!).toString().trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).action)).toEqual(['user.delete'])
    const m4 = manifest(s, '2026-11-04'), m5 = manifest(s, '2026-11-05')
    expect(m4.prev_manifest_sha256).toBeNull()
    expect(m5.prev_manifest_sha256).toBe(sha(s.m.get('audit/v1/2026/11/04/manifest.json')!))
    const f = m5.files.find((x) => x.table === 'admin_audit_log')!
    expect(f.sha256).toBe(sha(s.m.get(f.key)!))
    expect(m5.files.map((x) => x.table)).toEqual(ARCHIVE_TABLES.map((t) => t.table))
    // manifest は各日の最後に書く
    expect(s.puts.indexOf('audit/v1/2026/11/04/manifest.json')).toBe(ARCHIVE_TABLES.length)
  })

  it('★2 回目は書かない (present)・翌日は前の日につなぐ', async () => {
    const s = memStore()
    await runAuditArchive(fakeDb(data), s, { now, days: 2 })
    const n = s.puts.length
    const r = await runAuditArchive(fakeDb(data), s, { now, days: 2 })
    expect(r.days.every((d) => d.status === 'present')).toBe(true)
    expect(s.puts.length).toBe(n)
    const r2 = await runAuditArchive(fakeDb(data), s, { now: new Date('2026-11-07T04:00:00Z'), days: 3 })
    expect(r2.days.map((d) => d.status)).toEqual(['present', 'present', 'exported'])
    expect(manifest(s, '2026-11-06').prev_manifest_sha256).toBe(sha(s.m.get('audit/v1/2026/11/05/manifest.json')!))
  })

  it('★manifest の前で止まった日は、置き場にあるファイルを正として manifest を書く', async () => {
    const s = memStore()
    // 前の実行が 1 表だけ書いて止まった (中身は今の DB と違う)
    const { gzipSync } = await import('node:zlib')
    const old = gzipSync(Buffer.from('{"id":"1","action":"old"}\n{"id":"9","action":"old2"}\n'))
    s.m.set('audit/v1/2026/11/05/admin_audit_log.jsonl.gz', old)
    await runAuditArchive(fakeDb(data), s, { now, days: 1 })
    expect(s.m.get('audit/v1/2026/11/05/admin_audit_log.jsonl.gz')).toBe(old)
    const f = manifest(s, '2026-11-05').files.find((x) => x.table === 'admin_audit_log')!
    expect(f).toMatchObject({ rows: 2, sha256: sha(old) })
  })

  it('★失敗した日で止め、後ろの日は次に回す', async () => {
    const s = memStore()
    const r = await runAuditArchive(fakeDb(data, 'video_sessions'), s, { now, days: 3 })
    expect(r.ok).toBe(false)
    expect(r.days).toHaveLength(1)
    expect(r.days[0]).toMatchObject({ date: '2026-11-03', status: 'error' })
    expect(r.deferred).toBe(2)
    expect([...s.m.keys()].some((k) => k.endsWith('manifest.json'))).toBe(false)
  })

  it('★時間切れなら新しい日に手を付けない', async () => {
    const s = memStore()
    const r = await runAuditArchive(fakeDb(data), s, { now, days: 3, deadline: Date.now() - 1 })
    expect(r.ok).toBe(true)
    expect(r.days).toHaveLength(0)
    expect(r.deferred).toBe(3)
  })

  it('★あとからさかのぼると、鎖の先頭だった日に link.json を書いてつなぐ', async () => {
    const s = memStore()
    // 置き場を作った日: 11/05 だけ書く (先頭なので prev は null)
    await runAuditArchive(fakeDb(data), s, { now, days: 1 })
    expect(manifest(s, '2026-11-05').prev_manifest_sha256).toBeNull()
    const m5 = s.m.get('audit/v1/2026/11/05/manifest.json')!
    // あとから 3 日さかのぼる
    const r = await runAuditArchive(fakeDb(data), s, { now, days: 3 })
    expect(r.days.map((d) => [d.date, d.status, d.linked ?? false])).toEqual([
      ['2026-11-03', 'exported', false],
      ['2026-11-04', 'exported', false],
      ['2026-11-05', 'present', true],
    ])
    // 11/05 の manifest は書き換えない
    expect(s.m.get('audit/v1/2026/11/05/manifest.json')).toBe(m5)
    const link = JSON.parse(s.m.get('audit/v1/2026/11/05/link.json')!.toString())
    expect(link).toMatchObject({
      version: 1,
      date: '2026-11-05',
      manifest_sha256: sha(m5),
      prev_manifest_sha256: sha(s.m.get('audit/v1/2026/11/04/manifest.json')!),
    })
    expect(manifest(s, '2026-11-04').prev_manifest_sha256).toBe(sha(s.m.get('audit/v1/2026/11/03/manifest.json')!))
    // もう一度流しても link.json は書き直さず、つながったままと答える
    const n = s.puts.length
    const r2 = await runAuditArchive(fakeDb(data), s, { now, days: 3 })
    expect(r2.days.map((d) => d.linked ?? false)).toEqual([false, false, true])
    expect(s.puts.length).toBe(n)
  })

  it('★前の日を時間切れで書けなかったら、つながない', async () => {
    const s = memStore()
    await runAuditArchive(fakeDb(data), s, { now, days: 1 })
    const r = await runAuditArchive(fakeDb(data), s, { now, days: 3, deadline: Date.now() - 1 })
    expect(r.deferred).toBe(2)
    expect(r.days).toEqual([{ date: '2026-11-05', status: 'present' }])
    expect(s.m.has('audit/v1/2026/11/05/link.json')).toBe(false)
  })

  it('鎖の途中の日・前の日が置き場に無い先頭の日には link.json を書かない', async () => {
    const s = memStore()
    await runAuditArchive(fakeDb(data), s, { now, days: 3 })
    await runAuditArchive(fakeDb(data), s, { now, days: 3 })
    expect([...s.m.keys()].some((k) => k.endsWith('link.json'))).toBe(false)
  })

  it('1 000 行を超える日も全部読む', async () => {
    const many: Row[] = Array.from({ length: 2345 }, (_, i) => ({ id: String(i).padStart(5, '0'), ts: '2026-11-05T12:00:00Z' }))
    const s = memStore()
    const r = await runAuditArchive(fakeDb({ ...data, admin_audit_log: many }), s, { now, days: 1 })
    expect(manifest(s, '2026-11-05').files[0].rows).toBe(2345)
    expect(r.days[0].rows).toBe(2345 + 1)
  })
})
