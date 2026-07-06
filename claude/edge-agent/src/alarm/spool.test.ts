import { describe, it, expect } from 'vitest'
import {
  classifySendResult, spoolFileName, receivedMsFromFileName, isExpired,
  encodeEntry, decodeEntry, SPOOL_MAX_AGE_MS, type SpooledAlarm,
} from './spool-core.js'

describe('classifySendResult', () => {
  it('2xx は ok', () => {
    expect(classifySendResult(200)).toBe('ok')
    expect(classifySendResult(204)).toBe('ok')
  })
  it('ネットワーク断(null)/5xx/429 は transient（再送対象）', () => {
    expect(classifySendResult(null)).toBe('transient')
    expect(classifySendResult(500)).toBe('transient')
    expect(classifySendResult(502)).toBe('transient')
    expect(classifySendResult(429)).toBe('transient')
  })
  it('その他 4xx は permanent（破棄）', () => {
    expect(classifySendResult(400)).toBe('permanent')
    expect(classifySendResult(401)).toBe('permanent')
    expect(classifySendResult(404)).toBe('permanent')
  })
})

describe('spool ファイル名', () => {
  it('名前順 ＝ 受信順（ゼロ詰め）で、受信時刻を復元できる', () => {
    const a = spoolFileName(1_000, 'aa')
    const b = spoolFileName(1_751_800_000_000, 'bb')
    expect([b, a].sort()).toEqual([a, b])
    expect(receivedMsFromFileName(b)).toBe(1_751_800_000_000)
  })
  it('不正な名前は null', () => {
    expect(receivedMsFromFileName('garbage.json')).toBeNull()
    expect(receivedMsFromFileName('123.txt')).toBeNull()
  })
})

describe('isExpired', () => {
  const now = 1_751_800_000_000
  it('24時間以内は保持・超えたら破棄', () => {
    expect(isExpired(now - SPOOL_MAX_AGE_MS + 1_000, now)).toBe(false)
    expect(isExpired(now - SPOOL_MAX_AGE_MS - 1_000, now)).toBe(true)
  })
})

describe('encode/decode', () => {
  const entry: SpooledAlarm = {
    source: 'ipro', event_type: 'input', camera_id: 'cam-1',
    dedup_key: 'cam-1:input', occurred_at: '2026-07-05T00:00:00.000Z',
    image_b64: 'aGVsbG8=', attempts: 2,
  }
  it('往復して同値', () => {
    expect(decodeEntry(encodeEntry(entry))).toEqual(entry)
  })
  it('必須欠落・壊れた JSON は null', () => {
    expect(decodeEntry('{}')).toBeNull()
    expect(decodeEntry('not json')).toBeNull()
    expect(decodeEntry(JSON.stringify({ source: 'ipro' }))).toBeNull()
  })
  it('省略可能フィールドは既定値で補完', () => {
    const min = decodeEntry(JSON.stringify({ source: 'ipro', occurred_at: 'x', dedup_key: 'k' }))
    expect(min).toEqual({
      source: 'ipro', event_type: 'input', camera_id: null,
      dedup_key: 'k', occurred_at: 'x', image_b64: null, attempts: 0,
    })
  })
})
