import { describe, it, expect } from 'vitest'
import { nextTunnelState, probeStatusOk, TUNNEL_ALERT_AFTER_SEC } from './tunnel-health'

const T0 = Date.parse('2026-07-20T00:00:00Z')
const sec = (n: number) => n * 1000

describe('nextTunnelState', () => {
  it('正常 → 正常: 何もしない', () => {
    const d = nextTunnelState(true, { downSince: null, alertedAt: null }, T0)
    expect(d).toEqual({ downSince: null, alertedAt: null, action: 'none' })
  })

  it('初回失敗: downSince を刻むだけ（フラップ吸収・通知しない）', () => {
    const d = nextTunnelState(false, { downSince: null, alertedAt: null }, T0)
    expect(d.downSince).toBe(new Date(T0).toISOString())
    expect(d.alertedAt).toBeNull()
    expect(d.action).toBe('none')
  })

  it('閾値未満の継続失敗: まだ通知しない', () => {
    const downSince = new Date(T0).toISOString()
    const d = nextTunnelState(false, { downSince, alertedAt: null }, T0 + sec(TUNNEL_ALERT_AFTER_SEC - 1))
    expect(d.action).toBe('none')
    expect(d.alertedAt).toBeNull()
    expect(d.downSince).toBe(downSince)
  })

  it('閾値超過の継続失敗: アラート（1回だけ）', () => {
    const downSince = new Date(T0).toISOString()
    const now = T0 + sec(TUNNEL_ALERT_AFTER_SEC)
    const d = nextTunnelState(false, { downSince, alertedAt: null }, now)
    expect(d.action).toBe('alert')
    expect(d.alertedAt).toBe(new Date(now).toISOString())

    // 通知済みの継続失敗では再通知しない
    const d2 = nextTunnelState(false, { downSince, alertedAt: d.alertedAt }, now + sec(600))
    expect(d2.action).toBe('none')
    expect(d2.alertedAt).toBe(d.alertedAt)
  })

  it('未通知のまま復旧: 揉み消してリセット（復旧通知は出さない）', () => {
    const downSince = new Date(T0).toISOString()
    const d = nextTunnelState(true, { downSince, alertedAt: null }, T0 + sec(60))
    expect(d).toEqual({ downSince: null, alertedAt: null, action: 'none' })
  })

  it('通知済みから復旧: 復旧通知を出してリセット', () => {
    const d = nextTunnelState(true, { downSince: new Date(T0).toISOString(), alertedAt: new Date(T0 + sec(180)).toISOString() }, T0 + sec(600))
    expect(d).toEqual({ downSince: null, alertedAt: null, action: 'recover' })
  })
})

describe('probeStatusOk', () => {
  it('2xx/3xx/4xx はトンネル生存とみなす（認証・パス起因の4xxは正常）', () => {
    expect(probeStatusOk(200)).toBe(true)
    expect(probeStatusOk(302)).toBe(true)
    expect(probeStatusOk(401)).toBe(true)
    expect(probeStatusOk(404)).toBe(true)
  })
  it('5xx（530=tunnel down / 502 / 504）は断', () => {
    expect(probeStatusOk(502)).toBe(false)
    expect(probeStatusOk(504)).toBe(false)
    expect(probeStatusOk(530)).toBe(false)
  })
})
