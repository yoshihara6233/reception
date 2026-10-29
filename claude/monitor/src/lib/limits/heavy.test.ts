import { describe, expect, it, vi } from 'vitest'
import { HEAVY_LIMITS, heavyAllows, heavyKey, tooManyRequests } from './heavy'

/**
 * 重い処理の回数の上限 (自主診断 ASVS 15.2.2・2.4.1)。
 * 判定そのものは DB の rate_limit_hit が持つので、ここでは呼び出し側の契約を見る。
 *   - 決まりを上から順に当て、1 つでも超えたら断る (後ろの決まりは数えない)
 *   - ID の無い範囲は飛ばす・all はアプリ全体で 1 つの鍵
 *   - DB が投げてもフェイルオープン
 */

function svc(answers: boolean[] | 'throw') {
  const keys: { key: string; limit: number; window: string }[] = []
  const client = {
    rpc: async (_fn: string, a: Record<string, unknown>) => {
      if (answers === 'throw') throw new Error('network')
      keys.push({ key: a.p_key as string, limit: a.p_limit as number, window: a.p_window as string })
      return { data: answers[keys.length - 1] ?? true, error: null }
    },
  }
  return { client: client as never, keys }
}

describe('heavyAllows', () => {
  it('全部の決まりを通れば ok', async () => {
    const { client, keys } = svc([true, true, true])
    expect(await heavyAllows(client, 'bcp-zip', { user: 'u1' })).toEqual({ ok: true })
    expect(keys.map((k) => k.key)).toEqual([
      'bcp-zip:user:60s:u1',
      'bcp-zip:user:3600s:u1',
      'bcp-zip:all:60s:app',
    ])
  })

  it('短い窓で断ったら、1 時間の窓は数えない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, keys } = svc([false])
    expect(await heavyAllows(client, 'bcp-zip', { user: 'u1' })).toEqual({ ok: false, retryAfterSec: 60 })
    expect(keys).toHaveLength(1)
    warn.mockRestore()
  })

  it('ID の無い範囲は飛ばす (店舗の決まりだけの処理に利用者だけを渡しても数えない)', async () => {
    const { client, keys } = svc([])
    expect(await heavyAllows(client, 'face-auth', { user: 'u1' })).toEqual({ ok: true })
    expect(keys).toHaveLength(0)
  })

  it('Nominatim はアプリ全体で 1 秒 1 回', async () => {
    const { client, keys } = svc([true])
    await heavyAllows(client, 'nominatim', {})
    expect(keys).toEqual([{ key: 'nominatim:all:1s:app', limit: 1, window: '1 seconds' }])
  })

  it('DB の呼び出しが投げても通す (フェイルオープン)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = svc('throw')
    expect(await heavyAllows(client, 'csv-import', { user: 'u1' })).toEqual({ ok: true })
    warn.mockRestore()
  })

  it('鍵の先頭は処理名 (記録には種類だけが出る・利用者 ID は出ない)', () => {
    expect(heavyKey('vod-request', HEAVY_LIMITS['vod-request'][0], 'u1').split(':')[0]).toBe('vod-request')
  })

  it('どの処理にも決まりがあり、値は正', () => {
    for (const [action, rules] of Object.entries(HEAVY_LIMITS)) {
      expect(rules.length, action).toBeGreaterThan(0)
      for (const r of rules) {
        expect(r.limit, action).toBeGreaterThan(0)
        expect(r.windowSec, action).toBeGreaterThan(0)
      }
    }
  })
})

describe('tooManyRequests', () => {
  it('429・Retry-After・日本語の message', async () => {
    const res = tooManyRequests(60)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    const j = await res.json()
    expect(j.error).toBe('rate_limited')
    expect(j.message).toMatch(/しばらくしてから/)
  })
})
