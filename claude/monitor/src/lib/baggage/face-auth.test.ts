/**
 * 顔認証ヘルパのユニット（M3）
 */
import { describe, expect, test } from 'vitest'
import { withTimeout, lastNameOf, jstYmd } from './face-auth'

describe('withTimeout（3秒レース）', () => {
  test('間に合えば値を返す', async () => {
    const r = await withTimeout(Promise.resolve(42), 1000)
    expect(r).toEqual({ ok: true, value: 42 })
  })
  test('超過は ok:false timeout', async () => {
    const never = new Promise<number>(() => {})
    const r = await withTimeout(never, 20)
    expect(r).toEqual({ ok: false, reason: 'timeout' })
  })
  test('reject は ok:false error（throw しない＝キオスクを止めない）', async () => {
    const r = await withTimeout(Promise.reject(new Error('aws down')), 1000)
    expect(r).toEqual({ ok: false, reason: 'error' })
  })
})

describe('lastNameOf（姓のみ・OV#13）', () => {
  test('半角/全角スペース区切りの先頭', () => {
    expect(lastNameOf('田中 花子')).toBe('田中')
    expect(lastNameOf('田中　花子')).toBe('田中')
  })
  test('区切りなしはそのまま', () => {
    expect(lastNameOf('田中')).toBe('田中')
  })
  test('前後空白は無視', () => {
    expect(lastNameOf('  佐藤 健 ')).toBe('佐藤')
  })
})

describe('jstYmd', () => {
  test('UTC深夜でも JST 日付の yyyymmdd', () => {
    expect(jstYmd(new Date('2026-07-18T20:00:00Z'))).toBe('20260719')
  })
})
