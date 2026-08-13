import { describe, expect, it, vi } from 'vitest'

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { allowIngestUrl, checkIngestUrl } from './ingest-guard.js'
import { logger } from './logger.js'

/**
 * 命令に載ってきた ingest 先の検証。
 *
 * クラウド側の allowlist が本来の境界で、ここはその内側の 2 枚目。
 * **クラウド側に将来穴が開いても、エッジが見知らぬ宛先へカメラ画像を
 * 送らない**ことを固定する。
 */

const MONITOR = 'https://intereco-monitor.vercel.app'

describe('checkIngestUrl', () => {
  it('★同一オリジンなら通す', () => {
    expect(checkIngestUrl(`${MONITOR}/api/security/patrol/ingest`, MONITOR))
      .toEqual({ allowed: true, reason: 'same_origin' })
  })

  it('★別ホストは拒否（画像の持ち出し）', () => {
    expect(checkIngestUrl('https://attacker.example/collect', MONITOR))
      .toEqual({ allowed: false, reason: 'cross_origin' })
  })

  it('★ホスト名の前方一致で騙されない', () => {
    // `intereco-monitor.vercel.app.attacker.example` のような形。
    expect(checkIngestUrl(`${MONITOR}.attacker.example/x`, MONITOR).allowed).toBe(false)
  })

  it('★スキームが違えば拒否（http へ落として盗聴する形）', () => {
    expect(checkIngestUrl('http://intereco-monitor.vercel.app/x', MONITOR).allowed).toBe(false)
  })

  it('ポートが違えば拒否', () => {
    expect(checkIngestUrl('https://intereco-monitor.vercel.app:8443/x', MONITOR).allowed).toBe(false)
  })

  it('パスやクエリが違っても、同一オリジンなら通す', () => {
    expect(checkIngestUrl(`${MONITOR}/api/alarms/frames?x=1`, MONITOR).allowed).toBe(true)
  })

  it('URL として解釈できないものは拒否', () => {
    for (const bad of ['', '/api/relative', 'not a url', 'javascript:alert(1)/']) {
      expect(checkIngestUrl(bad, MONITOR).allowed).toBe(false)
    }
  })

  describe('MONITOR_URL が無いとき', () => {
    it('★検証できないので通す（証跡を黙って失うより設定漏れを見せる）', () => {
      // 一律拒否にすると、設定漏れの端末で巡回・発報の証跡取得が
      // 「撮れていない」形で止まる。実際に未設定のまま稼働していた端末がある。
      expect(checkIngestUrl('https://anywhere.example/x', undefined))
        .toEqual({ allowed: true, reason: 'no_baseline' })
    })

    it('MONITOR_URL 自体が壊れていても同じ扱い', () => {
      expect(checkIngestUrl('https://anywhere.example/x', 'not a url').reason).toBe('no_baseline')
    })

    it('それでも URL として壊れているものは通さない', () => {
      expect(checkIngestUrl('not a url', undefined).allowed).toBe(false)
    })
  })
})

describe('allowIngestUrl（ログ）', () => {
  it('正常時は何も鳴らさない', () => {
    vi.mocked(logger.error).mockClear()
    expect(allowIngestUrl(`${MONITOR}/x`, MONITOR, 'capture_snapshot')).toBe(true)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('★拒否したら error で残す（クラウド側の allowlist を抜けている＝異常）', () => {
    vi.mocked(logger.error).mockClear()
    expect(allowIngestUrl('https://attacker.example/x', MONITOR, 'capture_snapshot')).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
    // 追跡できるよう URL と命令名を残す。
    const [ctx] = vi.mocked(logger.error).mock.calls[0] as [Record<string, unknown>, string]
    expect(ctx).toMatchObject({ url: 'https://attacker.example/x', action: 'capture_snapshot' })
  })

  it('★MONITOR_URL 未設定は「検証が効いていない」として error で鳴らす', () => {
    vi.mocked(logger.error).mockClear()
    expect(allowIngestUrl(`${MONITOR}/x`, undefined, 'capture_snapshot')).toBe(true)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(logger.error).mock.calls[0][1])).toContain('MONITOR_URL')
  })
})
