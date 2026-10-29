import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidInput } from './invalid-input'
import { resetSecurityEventThrottle } from '@/lib/security/events'

/**
 * 入力の検査の失敗の記録 (自主診断 ASVS 16.3.3)。
 * 記録に残すのは種類・道・利用者 ID・接続元・状態だけで、入力の中身は書かない。
 */

beforeEach(() => { resetSecurityEventThrottle() })
afterEach(() => { vi.restoreAllMocks() })

function lines(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((l: string) => l.startsWith('[security] '))
    .map((l: string) => JSON.parse(l.slice('[security] '.length)))
}

describe('invalidInput', () => {
  it('400 と渡した本文を返し、input.invalid を記録する', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = new Request('https://gvms-cloud.com/api/admin/stores?x=1', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      body: JSON.stringify({ name: '秘密の店舗名', password: 'hunter2' }),
    })
    const res = invalidInput(req, { error: 'invalid_body' }, 'u-1')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    const [e] = lines(warn)
    expect(e).toMatchObject({ kind: 'input.invalid', actor: 'u-1', ip: '203.0.113.5', path: '/api/admin/stores', status: 400 })
  })

  it('入力の中身・問い合わせの文字列・誤りの詳細は記録に書かない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = new Request('https://gvms-cloud.com/api/feedback?token=abc', { method: 'POST', body: '{"pin":"123456"}' })
    invalidInput(req, { error: 'invalid_body', detail: { pin: { _errors: ['123456 は短い'] } } })
    const raw = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(raw).not.toContain('123456')
    expect(raw).not.toContain('token=abc')
    expect(raw).not.toContain('detail')
  })

  it('同じ道・同じ接続元が続いても 60 秒に 1 行', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = () => new Request('https://gvms-cloud.com/api/vod', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.7' } })
    for (let i = 0; i < 50; i++) invalidInput(req())
    expect(lines(warn)).toHaveLength(1)
  })
})
