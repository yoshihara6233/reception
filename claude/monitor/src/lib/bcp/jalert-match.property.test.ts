import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  intensityRank,
  parseAffectedPrefs,
  shouldTrigger,
  storeAreaIntensity,
} from '../../../supabase/functions/jalert-poller/match'

/**
 * J-Alert 照合のプロパティ（性質）テスト。
 *
 * ── なぜ性質で書くか ──────────────────────────────────────────────────
 * 2026-08-09 03:02 の岩手県沖・震度4 で **38 店舗へ誤発報**した原因は、
 * 3 桁の細分区域コードの先頭 2 桁を JIS 都道府県として扱ったことだった
 * （210「岩手県沿岸北部」→ "21" = 岐阜県）。
 *
 * これは**人が思いつく例では出ない**類の誤りで、実際 jalert-match.test.ts の
 * 例示テストは当時も通っていた。「どの 3 桁コードを入れても県は出ない」と
 * 性質で書けば、コードを総当たりして必ず落ちる。
 *
 * 例示テスト（jalert-match.test.ts / jalert-real-xml.test.ts）は実配信 XML で
 * 「これは通る」を固定する担当。ここは補集合——**入力空間の全体で成り立つ
 * べき関係**を担当する。
 */

const RUNS = { numRuns: 5_000 }

/** JMA の震度表記。intensityRank が知っている値。 */
const INTENSITIES = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'] as const
const intensity = () => fc.constantFrom(...INTENSITIES)
/** JIS 都道府県 01〜47。 */
const jisPref = () => fc.integer({ min: 1, max: 47 }).map((n) => String(n).padStart(2, '0'))
/** 細分区域・津波予報区。**JIS とは別体系**で、先頭 2 桁に意味は無い。 */
const threeDigit = () => fc.integer({ min: 100, max: 999 }).map(String)

const prefBlock = (code: string, int: string | null) =>
  `<Pref><Code>${code}</Code>${int ? `<MaxInt>${int}</MaxInt>` : ''}</Pref>`

describe('都道府県の導出', () => {
  it('★3 桁コードからは県を導出しない（38 店舗誤発報の再現防止）', () => {
    // <Area> に何が入っていても県は出ない。ここが破れると、
    // 210 → "21"(岐阜県) のように**揺れていない県が一致する**。
    fc.assert(fc.property(fc.array(threeDigit(), { minLength: 1, maxLength: 20 }), (codes) => {
      const xml = codes.map((c) => `<Area><Code>${c}</Code><MaxInt>4</MaxInt></Area>`).join('')
      expect([...parseAffectedPrefs(xml).keys()], `3桁コードから県が出ました: ${codes}`).toEqual([])
    }), RUNS)
  })

  it('★Pref の中に 3 桁の Area があっても、拾うのは Pref の 2 桁だけ', () => {
    // 実配信 VXSE53 の入れ子はこの形（Pref > Area > City）。
    fc.assert(fc.property(jisPref(), threeDigit(), (pref, area) => {
      const xml = `<Pref><Code>${pref}</Code><MaxInt>4</MaxInt>`
        + `<Area><Code>${area}</Code><MaxInt>4</MaxInt></Area></Pref>`
      expect([...parseAffectedPrefs(xml).keys()]).toEqual([pref])
    }), RUNS)
  })

  it('鍵は必ず JIS 都道府県 01〜47 の 2 桁', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 99 }).map((n) => String(n).padStart(2, '0')),
        { minLength: 1, maxLength: 20 }),
      (codes) => {
        const xml = codes.map((c) => prefBlock(c, '4')).join('')
        for (const k of parseAffectedPrefs(xml).keys()) {
          expect(k).toMatch(/^\d{2}$/)
          expect(Number(k)).toBeGreaterThanOrEqual(1)
          expect(Number(k)).toBeLessThanOrEqual(47)
        }
      }), RUNS)
  })

  it('City の 5 桁以上は先頭 2 桁が県（4310400 → 43）', () => {
    fc.assert(fc.property(jisPref(), fc.integer({ min: 0, max: 99_999 }), (pref, rest) => {
      const xml = `<City><Code>${pref}${String(rest).padStart(5, '0')}</Code><MaxInt>3</MaxInt></City>`
      expect([...parseAffectedPrefs(xml).keys()]).toEqual([pref])
    }), RUNS)
  })

  it('Pref も City も無ければ空（津波・ミサイルの電文）', () => {
    // 空を「県が取れない」として呼び出し側が明示的に扱う契約
    // （resolveAreaScope）。ここが勝手に何か返すとその分岐が死ぬ。
    fc.assert(fc.property(fc.array(threeDigit(), { maxLength: 10 }), (codes) => {
      const xml = codes.map((c) => `<Code>${c}</Code>`).join('')
      expect(parseAffectedPrefs(xml).size).toBe(0)
    }), RUNS)
  })
})

describe('震度は県ごとに保つ', () => {
  it('★全国最大値を全店舗に配らない', () => {
    // もう一方の誤発報原因。全国最大を配ると、震度1の県の店舗が
    // 「震度4」として発動条件を通ってしまう。
    fc.assert(fc.property(
      fc.uniqueArray(fc.tuple(jisPref(), intensity()), {
        minLength: 2, maxLength: 20, selector: ([p]) => p,
      }),
      (pairs) => {
        const xml = pairs.map(([p, i]) => prefBlock(p, i)).join('')
        const map = parseAffectedPrefs(xml)
        for (const [pref, int] of pairs) {
          const got = storeAreaIntensity(`${pref}000`, map)
          expect(got.matched).toBe(true)
          expect(got.intensity, `${pref} に他県の震度が付いています`).toBe(int)
        }
      }), RUNS)
  })

  it('同じ県が複数回出たら強いほうが残る', () => {
    fc.assert(fc.property(jisPref(), fc.array(intensity(), { minLength: 2, maxLength: 8 }),
      (pref, ints) => {
        const xml = ints.map((i) => prefBlock(pref, i)).join('')
        const got = parseAffectedPrefs(xml).get(pref) ?? null
        const strongest = ints.reduce((a, b) => (intensityRank(b) > intensityRank(a) ? b : a))
        expect(intensityRank(got)).toBe(intensityRank(strongest))
      }), RUNS)
  })

  it('順序を入れ替えても結果は同じ（電文の並び順に依存しない）', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.tuple(jisPref(), intensity()), { minLength: 1, maxLength: 12, selector: ([p]) => p }),
      (pairs) => {
        const fwd = parseAffectedPrefs(pairs.map(([p, i]) => prefBlock(p, i)).join(''))
        const rev = parseAffectedPrefs([...pairs].reverse().map(([p, i]) => prefBlock(p, i)).join(''))
        expect([...fwd.entries()].sort()).toEqual([...rev.entries()].sort())
      }), RUNS)
  })

  it('店舗の県が発表に無ければ不一致（震度も返さない）', () => {
    fc.assert(fc.property(jisPref(), jisPref(), intensity(), (a, b, int) => {
      fc.pre(a !== b)
      expect(storeAreaIntensity(`${a}000`, parseAffectedPrefs(prefBlock(b, int))).matched).toBe(false)
    }), RUNS)
  })

  it('発表が空なら常に不一致', () => {
    fc.assert(fc.property(fc.option(fc.string(), { nil: null }), (code) => {
      expect(storeAreaIntensity(code, new Map()))
        .toEqual({ matched: false, intensity: null })
    }), RUNS)
  })
})

describe('発動条件', () => {
  it('★震度が強いほど発動しやすい（単調）', () => {
    // 「震度5+ では発動するのに 6- では発動しない」という穴が空かないこと。
    fc.assert(fc.property(intensity(), intensity(), intensity(), (a, b, threshold) => {
      const s = { quake_min_intensity: threshold, tsunami_enabled: true, missile_enabled: true }
      if (intensityRank(a) >= intensityRank(b) && shouldTrigger('earthquake', b, s)) {
        expect(shouldTrigger('earthquake', a, s), `${b} で発動して ${a} で発動しません`).toBe(true)
      }
    }), RUNS)
  })

  it('しきい値を上げれば発動は増えない（単調）', () => {
    fc.assert(fc.property(intensity(), intensity(), intensity(), (obs, lo, hi) => {
      fc.pre(intensityRank(lo) <= intensityRank(hi))
      const at = (t: string) => shouldTrigger('earthquake', obs,
        { quake_min_intensity: t, tsunami_enabled: true, missile_enabled: true })
      if (at(hi)) expect(at(lo), 'しきい値を下げたのに発動しなくなりました').toBe(true)
    }), RUNS)
  })

  it('震度が取れない（null）なら地震では発動しない', () => {
    // ランク 0 は「条件未満」。壊れた電文で全店が録画を始めないための下限。
    fc.assert(fc.property(intensity(), (threshold) => {
      expect(shouldTrigger('earthquake', null,
        { quake_min_intensity: threshold, tsunami_enabled: true, missile_enabled: true })).toBe(false)
    }), RUNS)
  })

  it('未知の種別では発動しない', () => {
    fc.assert(fc.property(
      fc.string().filter((s) => !['earthquake', 'tsunami', 'missile'].includes(s)),
      fc.option(intensity(), { nil: null }),
      (type, int) => {
        expect(shouldTrigger(type, int,
          { quake_min_intensity: '1', tsunami_enabled: true, missile_enabled: true })).toBe(false)
      }), RUNS)
  })

  it('津波・ミサイルは震度に依らず設定だけで決まる', () => {
    fc.assert(fc.property(fc.option(intensity(), { nil: null }), fc.boolean(), fc.boolean(),
      (int, tsunami, missile) => {
        const s = { quake_min_intensity: '7', tsunami_enabled: tsunami, missile_enabled: missile }
        expect(shouldTrigger('tsunami', int, s)).toBe(tsunami)
        expect(shouldTrigger('missile', int, s)).toBe(missile)
      }), RUNS)
  })
})
