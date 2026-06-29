/**
 * TC3: deriveEdgeStatus（監視中断の見える化・単一源）の契約テスト。
 *
 * 核心は「last_seen_at が古ければ status 文字列(grid 等)を無視して中断と判定する」。
 * これが崩れると、クラッシュしたエッジが UI で『監視中』に化けて顧客に中断が見えない。
 */
import { describe, it, expect } from 'vitest'
import { deriveEdgeStatus, isMonitoringDown } from './edge-status'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'

const NOW = Date.parse('2026-06-29T12:00:00Z')
const agoSec = (s: number) => new Date(NOW - s * 1000).toISOString()

describe('deriveEdgeStatus（単一源・last_seen 鮮度が真実源）', () => {
  it('未設置: last_seen_at が null なら unconfigured', () => {
    const d = deriveEdgeStatus('grid', null, { nowMs: NOW })
    expect(d.plane).toBe('unconfigured')
    expect(d.staleSec).toBeNull()
    expect(isMonitoringDown(d)).toBe(false)
  })

  it('鮮度OK・動作中: grid はそのまま monitoring（mode 保持）', () => {
    const d = deriveEdgeStatus('grid', agoSec(30), { nowMs: NOW })
    expect(d.plane).toBe('monitoring')
    expect(d.mode).toBe('grid')
    expect(d.tone).toBe('ok')
    expect(isMonitoringDown(d)).toBe(false)
  })

  it('★ 中核: status=grid のまま古いと、grid を無視して interrupted に上書き', () => {
    const d = deriveEdgeStatus('grid', agoSec(MONITOR_STALE_SECONDS + 60), { nowMs: NOW })
    expect(d.plane).toBe('interrupted')
    expect(d.tone).toBe('down')
    expect(d.recordingContinues).toBe(true)   // 監視/録画区別: 録画は継続
    expect(isMonitoringDown(d)).toBe(true)
  })

  it('境界: ちょうど閾値で中断、1秒手前は monitoring', () => {
    expect(deriveEdgeStatus('grid', agoSec(MONITOR_STALE_SECONDS), { nowMs: NOW }).plane).toBe('interrupted')
    expect(deriveEdgeStatus('grid', agoSec(MONITOR_STALE_SECONDS - 1), { nowMs: NOW }).plane).toBe('monitoring')
  })

  it('正常停止: 鮮度OK かつ status=offline は stopped（意図的・録画継続）', () => {
    const d = deriveEdgeStatus('offline', agoSec(30), { nowMs: NOW })
    expect(d.plane).toBe('stopped')
    expect(d.recordingContinues).toBe(true)
    expect(isMonitoringDown(d)).toBe(true)
  })

  it('エラー: 鮮度OK かつ status=error は monitoring/warn（録画継続は断定しない）', () => {
    const d = deriveEdgeStatus('error', agoSec(10), { nowMs: NOW })
    expect(d.plane).toBe('monitoring')
    expect(d.tone).toBe('warn')
    expect(d.recordingContinues).toBe(false)
  })

  it('パース不能な last_seen_at は安全側 unconfigured（誤中断通知を出さない）', () => {
    const d = deriveEdgeStatus('grid', 'not-a-date', { nowMs: NOW })
    expect(d.plane).toBe('unconfigured')
  })

  it('staleSec を上書きできる（cron 運用調整との整合）', () => {
    const d = deriveEdgeStatus('grid', agoSec(120), { nowMs: NOW, staleSec: 60 })
    expect(d.plane).toBe('interrupted')
  })
})
