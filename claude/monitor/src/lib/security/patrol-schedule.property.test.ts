import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { hhmmToMin, inActiveWindow, isDue, jstNow, type PatrolSettings } from './patrol-schedule'

/**
 * 巡回スケジュールの時刻窓のプロパティ（性質）テスト。
 *
 * ── なぜ性質で書くか ──────────────────────────────────────────────────
 * 時刻窓の誤りは**日跨ぎ（22:00〜06:00）と端点**に集まる。例示テストは
 * 「9:00〜18:00 で 12:00 は入る」のような素直な例に寄りがちで、
 * 22:00〜06:00 の 23:59 / 00:00 / 06:00 ちょうど、が抜けやすい。
 *
 * ここで書く中心の性質は **窓とその裏返しがちょうど 1 日を二分すること**。
 * これが成り立てば、日跨ぎも端点も同時に保証される——個別に例を並べる
 * 必要が無くなる。
 *
 * 例示テスト（patrol-schedule.test.ts）は「この設定でこう動く」を固定する
 * 担当。ここは入力空間の全体を担当する。
 */

const RUNS = { numRuns: 20_000 }

/** 0..1440 分を "HH:MM" に。1440 は "24:00"（日の終わり）。 */
const toHhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** 1 日の中の時刻（分）。1440 は含まない＝実際に取りうる現在時刻。 */
const curMin = () => fc.integer({ min: 0, max: 1439 })
/** 窓の端点。1440（"24:00"）まで含む。 */
const edge = () => fc.integer({ min: 0, max: 1440 })

describe('inActiveWindow の不変条件', () => {
  it('★窓とその裏返しが 1 日をちょうど二分する（日跨ぎも端点も同時に保証される）', () => {
    // どの時刻も「窓の中」か「窓の外」のどちらか一方に必ず属する。
    // 破れ方は 2 通りあり、どちらも実害が出る:
    //   両方 true  … 窓の外でも巡回が走る（意図しない時間帯の撮影）
    //   両方 false … 窓の中でも走らない（証跡が欠ける）
    fc.assert(fc.property(curMin(), edge(), edge(), (cur, a, b) => {
      fc.pre(a !== b)
      const inside  = inActiveWindow(cur, toHhmm(a), toHhmm(b))
      const outside = inActiveWindow(cur, toHhmm(b), toHhmm(a))
      expect(inside, `${toHhmm(a)}〜${toHhmm(b)} で ${toHhmm(cur)} が両側に属しています`)
        .not.toBe(outside)
    }), RUNS)
  })

  it('日跨ぎの窓でも端点の扱いが同じ（from は含む・to は含まない）', () => {
    fc.assert(fc.property(edge(), edge(), (a, b) => {
      fc.pre(a !== b && a < 1440 && b < 1440)
      expect(inActiveWindow(a, toHhmm(a), toHhmm(b)), 'from ちょうどが入っていません').toBe(true)
      expect(inActiveWindow(b, toHhmm(a), toHhmm(b)), 'to ちょうどが入っています').toBe(false)
    }), RUNS)
  })

  it('from と to が同じなら終日（巡回を止めない）', () => {
    fc.assert(fc.property(curMin(), edge(), (cur, a) => {
      expect(inActiveWindow(cur, toHhmm(a), toHhmm(a))).toBe(true)
    }), RUNS)
  })

  it('窓の中の分数は |to - from| に一致する（数え落ちが無い）', () => {
    fc.assert(fc.property(edge(), edge(), (a, b) => {
      fc.pre(a !== b)
      const n = Array.from({ length: 1440 }, (_, m) => m)
        .filter((m) => inActiveWindow(m, toHhmm(a), toHhmm(b))).length
      expect(n).toBe(a < b ? b - a : 1440 - a + b)
    }), { numRuns: 2_000 })
  })

  it('読めない値は「終日」に倒れる（巡回が黙って止まらない）', () => {
    // from が読めなければ 0、to が読めなければ 1440。安全側は
    // 「撮り続ける」であって「止まる」ではない、という設計の固定。
    fc.assert(fc.property(curMin(), fc.string(), (cur, junk) => {
      fc.pre(hhmmToMin(junk) === null)
      expect(inActiveWindow(cur, junk, junk)).toBe(true)
    }), RUNS)
  })
})

describe('hhmmToMin', () => {
  it('"HH:MM" を分に直す（0:00〜24:00）', () => {
    fc.assert(fc.property(edge(), (m) => {
      expect(hhmmToMin(toHhmm(m))).toBe(m)
    }), RUNS)
  })

  it('前後の空白を無視する', () => {
    fc.assert(fc.property(edge(), fc.stringMatching(/^[ \t]*$/), (m, ws) => {
      expect(hhmmToMin(`${ws}${toHhmm(m)}${ws}`)).toBe(m)
    }), RUNS)
  })

  it('分が 60 以上・時が 25 以上なら null', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 24 }), fc.integer({ min: 60, max: 99 }),
      (h, mm) => { expect(hhmmToMin(`${h}:${mm}`)).toBeNull() }), RUNS)
    fc.assert(fc.property(fc.integer({ min: 25, max: 99 }), fc.integer({ min: 0, max: 59 }),
      (h, mm) => { expect(hhmmToMin(`${h}:${String(mm).padStart(2, '0')}`)).toBeNull() }), RUNS)
  })

  it('★"24:30" のような 1440 超の to は "24:00" と同じ挙動になる', () => {
    // hhmmToMin("24:30") は 1470 を返す（h<=24 かつ mm<=59 を通るため）。
    // 「時刻としては不正だが受理される」状態だが、**現在時刻は必ず 1439 以下**
    // なので窓の判定は 1440 と一致する。値としての不正を直すより、
    // **挙動が同じであること**を固定するほうが壊れにくい。
    expect(hhmmToMin('24:30')).toBe(1470)
    fc.assert(fc.property(
      curMin(), fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 0, max: 59 }),
      (cur, from, mm) => {
        expect(inActiveWindow(cur, toHhmm(from), `24:${String(mm).padStart(2, '0')}`))
          .toBe(inActiveWindow(cur, toHhmm(from), '24:00'))
      }), RUNS)
  })

  it('from = "24:00" は退化した設定（to 次第で終日か翌日窓になる）', () => {
    // 上の性質を from まで広げると、`from="24:00"` で破れる（総当たりが
    // 反例 cur=0 / from=24:00 / to=24:01 を出した）。**設定として意味が無い
    // 領域**なので性質の対象からは外し、実際の挙動をここに書き留めておく。
    // どちらも危険な側（窓外で撮る／窓内で撮らない）には倒れていない。
    expect(inActiveWindow(0, '24:00', '24:00'), 'from === to は終日').toBe(true)
    expect(inActiveWindow(0, '24:00', '24:01'), '空の窓になる').toBe(false)
    expect(inActiveWindow(400, '24:00', '09:00'), '00:00〜09:00 として振る舞う').toBe(true)
    expect(inActiveWindow(600, '24:00', '09:00')).toBe(false)
  })
})

describe('jstNow', () => {
  it('分は必ず 0..1439、曜日は 0..6', () => {
    fc.assert(fc.property(fc.date({ noInvalidDate: true }), (d) => {
      const { dow, minutes } = jstNow(d)
      expect(minutes).toBeGreaterThanOrEqual(0)
      expect(minutes).toBeLessThanOrEqual(1439)
      expect(dow).toBeGreaterThanOrEqual(0)
      expect(dow).toBeLessThanOrEqual(6)
    }), RUNS)
  })
})

describe('isDue の不変条件', () => {
  const settings = (over: Partial<PatrolSettings> = {}): PatrolSettings => ({
    store_id: 'store-1',
    enabled: true,
    schedule_mode: 'interval',
    patrol_interval_min: 30,
    active_from: '00:00',
    active_to: '24:00',
    active_days: [0, 1, 2, 3, 4, 5, 6],
    patrol_times: [],
    last_run_at: null,
    ...over,
  })
  const jst = () => fc.record({ dow: fc.integer({ min: 0, max: 6 }), minutes: curMin() })
  const NOW = new Date('2026-08-10T05:00:00+09:00')

  it('★無効・店舗未設定なら、他が何であっても走らない', () => {
    fc.assert(fc.property(jst(), fc.integer({ min: 1, max: 60 }), (t, w) => {
      expect(isDue(settings({ enabled: false }), t, NOW, w)).toBe(false)
      expect(isDue(settings({ store_id: null }), t, NOW, w)).toBe(false)
    }), RUNS)
  })

  it('★対象曜日でなければ走らない', () => {
    fc.assert(fc.property(jst(), fc.integer({ min: 1, max: 60 }), (t, w) => {
      const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== t.dow)
      expect(isDue(settings({ active_days: days }), t, NOW, w)).toBe(false)
    }), RUNS)
  })

  it('interval: 前回から間隔未満なら走らない', () => {
    fc.assert(fc.property(jst(), fc.integer({ min: 5, max: 240 }), fc.double({ min: 0, max: 0.99, noNaN: true }),
      (t, interval, frac) => {
        const lastRun = new Date(NOW.getTime() - interval * frac * 60_000).toISOString()
        expect(isDue(settings({ patrol_interval_min: interval, last_run_at: lastRun }), t, NOW, 10))
          .toBe(false)
      }), RUNS)
  })

  it('interval: 窓内かつ間隔経過なら走る', () => {
    fc.assert(fc.property(jst(), fc.integer({ min: 5, max: 240 }), fc.double({ min: 1, max: 5, noNaN: true }),
      (t, interval, mult) => {
        const lastRun = new Date(NOW.getTime() - interval * mult * 60_000).toISOString()
        expect(isDue(settings({ patrol_interval_min: interval, last_run_at: lastRun }), t, NOW, 10))
          .toBe(true)
      }), RUNS)
  })

  it('★一度も走っていなければ（last_run_at が null）走る', () => {
    // 導入直後の店舗が永久に走らない、という初期化漏れを防ぐ。
    fc.assert(fc.property(jst(), fc.integer({ min: 1, max: 1440 }), (t, interval) => {
      expect(isDue(settings({ patrol_interval_min: interval, last_run_at: null }), t, NOW, 10)).toBe(true)
    }), RUNS)
  })

  it('interval: 業務時間外なら走らない', () => {
    fc.assert(fc.property(curMin(), edge(), edge(), (cur, a, b) => {
      fc.pre(a !== b && !inActiveWindow(cur, toHhmm(a), toHhmm(b)))
      expect(isDue(
        settings({ active_from: toHhmm(a), active_to: toHhmm(b) }),
        { dow: 3, minutes: cur }, NOW, 10,
      )).toBe(false)
    }), RUNS)
  })

  it('fixed: 予定時刻がひとつも無ければ走らない', () => {
    fc.assert(fc.property(jst(), fc.integer({ min: 1, max: 60 }), (t, w) => {
      expect(isDue(settings({ schedule_mode: 'fixed', patrol_times: [] }), t, NOW, w)).toBe(false)
    }), RUNS)
  })

  it('fixed: 予定時刻から cron 窓のあいだだけ走る', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 30 }), fc.integer({ min: 0, max: 1439 }),
      (planned, window, cur) => {
        const due = isDue(
          settings({ schedule_mode: 'fixed', patrol_times: [toHhmm(planned)] }),
          { dow: 3, minutes: cur }, NOW, window,
        )
        expect(due).toBe(cur >= planned && cur < planned + window)
      }), RUNS)
  })
})
