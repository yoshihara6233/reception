import { describe, it, expect } from 'vitest'
import { isAlarmTokenValid } from './token.js'

const q = (s: string) => new URLSearchParams(s)

describe('isAlarmTokenValid', () => {
  it('検証無効（expected 空）なら常に許可', () => {
    expect(isAlarmTokenValid('', q(''), undefined)).toBe(true)
    expect(isAlarmTokenValid('', q('token=whatever'), undefined)).toBe(true)
  })

  it('query token の一致で許可・不一致/欠落は拒否', () => {
    expect(isAlarmTokenValid('s3cret', q('cam=a&token=s3cret'), undefined)).toBe(true)
    expect(isAlarmTokenValid('s3cret', q('cam=a&token=wrong'), undefined)).toBe(false)
    expect(isAlarmTokenValid('s3cret', q('cam=a'), undefined)).toBe(false)
    expect(isAlarmTokenValid('s3cret', q('token='), undefined)).toBe(false)
  })

  it('X-Alarm-Token ヘッダでも許可（query 優先）', () => {
    expect(isAlarmTokenValid('s3cret', q(''), 's3cret')).toBe(true)
    expect(isAlarmTokenValid('s3cret', q(''), 'wrong')).toBe(false)
    expect(isAlarmTokenValid('s3cret', q(''), ['s3cret'])).toBe(true)
    // query に token がある場合はそちらを見る（ヘッダ正でも query 不正なら拒否）
    expect(isAlarmTokenValid('s3cret', q('token=wrong'), 's3cret')).toBe(false)
  })

  it('前後空白は許容（カメラUIのコピペ対策）', () => {
    expect(isAlarmTokenValid('s3cret', q('token=%20s3cret%20'), undefined)).toBe(true)
  })
})
