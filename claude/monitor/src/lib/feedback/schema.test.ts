import { describe, expect, it } from 'vitest'
import { charCount, jstDayStartIso, parseTimestamp, sanitizeContext } from './schema'
import { pageStatusRows, type StatusRow } from './status-page'
import { boardCsv, parseBoardFilters, type BoardItem } from './board'
import { browserLabel, buildClientContext, osLabel, screenPath } from './client-context'

describe('sanitizeContext（§12.2: 既知の項目だけ・4 KB まで）', () => {
  it('既知の項目だけ残し、長すぎる値は切る', () => {
    const out = sanitizeContext({
      screen: 'live.grid', agent_version: 'nvmsd/0.1.104', error_code: 'rec.start_failed', viewport: 'x'.repeat(500),
      camera: { vendor: 'AXIS', model: 'M3116-LVE', firmware: '11.11', ip: '10.0.0.1', name: '入口' },
      user: 'admin', password: 'p',
    })
    expect(Object.keys(out).sort()).toEqual(['agent_version', 'camera', 'error_code', 'screen', 'viewport'])
    expect(out.viewport).toHaveLength(128)
    expect(out.camera).toEqual({ vendor: 'AXIS', model: 'M3116-LVE', firmware: '11.11' })
  })

  it('形が違う値は捨てる（拒否しない）', () => {
    expect(sanitizeContext(null)).toEqual({})
    expect(sanitizeContext('x')).toEqual({})
    expect(sanitizeContext([1, 2])).toEqual({})
    expect(sanitizeContext({ screen: 42, camera: 'i-PRO', os: '' })).toEqual({})
  })

  it('制御文字を落とす', () => {
    expect(sanitizeContext({ screen: 'live\n.grid\u0000' }).screen).toBe('live.grid')
  })
})

describe('数え方', () => {
  it('字数はサロゲートペアを 1 字と数える', () => {
    expect(charCount('𠮷野家')).toBe(3)
  })

  it('1 日は日本時間の 0:00 から', () => {
    expect(jstDayStartIso(new Date('2026-10-06T14:59:00Z'))).toBe('2026-10-05T15:00:00.000Z')
    expect(jstDayStartIso(new Date('2026-10-06T15:00:00Z'))).toBe('2026-10-06T15:00:00.000Z')
  })

  it('submitted_at は読めれば UTC の ISO、読めなければ null', () => {
    expect(parseTimestamp('2026-10-06T10:12:00+09:00')).toBe('2026-10-06T01:12:00.000Z')
    expect(parseTimestamp('きのう')).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
  })
})

describe('pageStatusRows（§12.3 の頁分け）', () => {
  const r = (id: string, t: string): StatusRow => ({ local_id: id, id, status: 'done', reply: null, fixed_version: null, updated_at: t })

  it('limit 以下なら next_since は null', () => {
    expect(pageStatusRows([r('a', '1')], 2)).toEqual({ items: [r('a', '1')], next_since: null })
  })

  it('★頁の境目が同時刻なら、その時刻の行を次の頁へ回す（取りこぼさない）', () => {
    const rows = [r('a', 't1'), r('b', 't2'), r('c', 't2')]
    expect(pageStatusRows(rows, 2)).toEqual({ items: [r('a', 't1')], next_since: 't1' })
  })

  it('頁全体が同時刻なら外さずに返す（先へ進めなくならない）', () => {
    const rows = [r('a', 't'), r('b', 't'), r('c', 't')]
    expect(pageStatusRows(rows, 2).items).toHaveLength(2)
  })
})

describe('要望ボードの絞り込みと CSV', () => {
  it('知らない値は無視する', () => {
    const f = parseBoardFilters((k) => ({ view: 'bogus', kind: 'bug', status: 'nope', tenant: 'not-uuid' } as Record<string, string>)[k])
    expect(f).toMatchObject({ view: 'new', kind: 'bug', status: null, tenant: null })
  })

  it('★CSV: 式として解釈される先頭（= + - @）を無効にし、引用符と改行を守る', () => {
    const item = {
      id: 'i1', tenant_id: 't1', store_id: null, edge_id: null, source: 'cloud', local_id: null, kind: 'bug', urgency: 'blocking',
      body: '=HYPERLINK("http://x")\n2 行目', contact_ok: true, role: 'tenant_admin', context: { screen: '/stores' },
      topic_id: null, status: 'received', reply: '-1', fixed_version: null, submitted_at: null,
      created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z',
    } as BoardItem
    const csv = boardCsv([item], { tenant: () => 'テナントA', store: () => '', topic: () => '' })
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")\n2 行目"`)
    expect(csv).toContain(",'-1,")
    expect(csv.startsWith('﻿受付日時,')).toBe(true)
  })
})

describe('クラウドの画面で自動で添える項目', () => {
  it('画面のパスは検索条件を落とし、UUID を [id] にする', () => {
    expect(screenPath('/stores/0b6c1f0e-6a51-4d0f-9a43-2f7e0c1d9a10/cam?x=1')).toBe('/stores/[id]/cam')
  })

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'chrome/141', 'windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'edge/141', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'safari/18', 'macos'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'safari/18', 'ios'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'firefox/131', 'linux'],
  ])('%s', (ua, browser, os) => {
    expect(browserLabel(ua)).toBe(browser)
    expect(osLabel(ua)).toBe(os)
  })

  it('添えるのは 画面のパス・ブラウザ・OS・画面の幅 だけ', () => {
    expect(Object.keys(buildClientContext({ pathname: '/bcp', userAgent: 'x', width: 1280.4, height: 800 })).sort())
      .toEqual(['browser', 'os', 'screen', 'viewport'])
  })
})
