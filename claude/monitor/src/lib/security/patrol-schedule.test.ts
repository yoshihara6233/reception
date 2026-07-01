/**
 * 警備 自動巡回スケジューラ（Phase A / A1）の due 判定テスト。
 *
 * 核心の落とし穴を固める:
 *   - JST 変換（cron は UTC で走る。業務時間・曜日は JST 判定でなければならない）
 *   - 業務時間窓の境界と日跨ぎ
 *   - interval の「前回から N 分経過」ゲート（4時間巡回の二重発火防止）
 *   - fixed モードの予定時刻一致
 */
import { describe, it, expect } from 'vitest'
import { jstNow, hhmmToMin, inActiveWindow, isDue, type PatrolSettings } from './patrol-schedule'

// 2026-07-01 03:30 UTC = 12:30 JST（水曜）。JST 変換の代表点。
const UTC_0330 = new Date('2026-07-01T03:30:00Z')

const base: PatrolSettings = {
  store_id: 'store-1',
  enabled: true,
  schedule_mode: 'interval',
  patrol_interval_min: 240,
  active_from: '00:00',
  active_to: '24:00',
  active_days: [0, 1, 2, 3, 4, 5, 6],
  patrol_times: [],
  last_run_at: null,
}

describe('jstNow', () => {
  it('UTC を JST（+9h）に変換する', () => {
    const { dow, minutes } = jstNow(UTC_0330)
    expect(minutes).toBe(12 * 60 + 30) // 12:30 JST
    expect(dow).toBe(3) // 2026-07-01 は水曜
  })
  it('UTC 深夜が JST で翌日午前になり曜日も繰り上がる', () => {
    // 2026-07-01 20:00 UTC = 2026-07-02 05:00 JST（木曜）
    const { dow, minutes } = jstNow(new Date('2026-07-01T20:00:00Z'))
    expect(minutes).toBe(5 * 60)
    expect(dow).toBe(4)
  })
})

describe('hhmmToMin', () => {
  it('境界値と不正入力', () => {
    expect(hhmmToMin('00:00')).toBe(0)
    expect(hhmmToMin('24:00')).toBe(1440)
    expect(hhmmToMin('09:05')).toBe(545)
    expect(hhmmToMin('bad')).toBeNull()
    expect(hhmmToMin('99:99')).toBeNull()
  })
})

describe('inActiveWindow', () => {
  it('通常窓 [09:00, 18:00)', () => {
    expect(inActiveWindow(540, '09:00', '18:00')).toBe(true) // 09:00 含む
    expect(inActiveWindow(1080, '09:00', '18:00')).toBe(false) // 18:00 は含まない
    expect(inActiveWindow(480, '09:00', '18:00')).toBe(false) // 08:00 前
  })
  it('全日 00:00-24:00', () => {
    expect(inActiveWindow(0, '00:00', '24:00')).toBe(true)
    expect(inActiveWindow(1439, '00:00', '24:00')).toBe(true)
  })
  it('日跨ぎ窓 22:00-06:00', () => {
    expect(inActiveWindow(1380, '22:00', '06:00')).toBe(true) // 23:00
    expect(inActiveWindow(60, '22:00', '06:00')).toBe(true) // 01:00
    expect(inActiveWindow(720, '22:00', '06:00')).toBe(false) // 12:00
  })
})

describe('isDue (interval)', () => {
  it('初回（last_run_at=null）は業務時間内なら due', () => {
    expect(isDue(base, jstNow(UTC_0330), UTC_0330, 10)).toBe(true)
  })
  it('4時間未満しか経っていなければ due でない', () => {
    const s = { ...base, last_run_at: new Date(UTC_0330.getTime() - 3 * 60 * 60 * 1000).toISOString() } // 3h前
    expect(isDue(s, jstNow(UTC_0330), UTC_0330, 10)).toBe(false)
  })
  it('4時間ちょうど以上経過で due', () => {
    const s = { ...base, last_run_at: new Date(UTC_0330.getTime() - 4 * 60 * 60 * 1000).toISOString() }
    expect(isDue(s, jstNow(UTC_0330), UTC_0330, 10)).toBe(true)
  })
  it('enabled=false は常に due でない', () => {
    expect(isDue({ ...base, enabled: false }, jstNow(UTC_0330), UTC_0330, 10)).toBe(false)
  })
  it('今日の曜日が active_days に無ければ due でない', () => {
    // UTC_0330 は水(3)。月・火のみ許可 → 対象外。
    expect(isDue({ ...base, active_days: [1, 2] }, jstNow(UTC_0330), UTC_0330, 10)).toBe(false)
  })
  it('業務時間外（JST 12:30 が 09-11 窓の外）は due でない', () => {
    expect(isDue({ ...base, active_from: '09:00', active_to: '11:00' }, jstNow(UTC_0330), UTC_0330, 10)).toBe(false)
  })
})

describe('isDue (fixed)', () => {
  const fixed: PatrolSettings = { ...base, schedule_mode: 'fixed', patrol_times: ['12:30', '18:00'] }
  it('予定時刻（JST 12:30）ちょうどの窓に入れば due', () => {
    expect(isDue(fixed, jstNow(UTC_0330), UTC_0330, 10)).toBe(true)
  })
  it('予定時刻から外れていれば due でない', () => {
    // 03:00 UTC = 12:00 JST。12:30/18:00 の窓外。
    const at1200 = new Date('2026-07-01T03:00:00Z')
    expect(isDue(fixed, jstNow(at1200), at1200, 10)).toBe(false)
  })
  it('同じ窓で既に走っていれば二重発火しない', () => {
    const s = { ...fixed, last_run_at: new Date(UTC_0330.getTime() - 2 * 60 * 1000).toISOString() } // 2分前
    expect(isDue(s, jstNow(UTC_0330), UTC_0330, 10)).toBe(false)
  })
})
