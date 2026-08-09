import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { haversineKm } from './geo'

/**
 * 距離計算のプロパティ（性質）テスト。
 *
 * ── 例示テストとの違い ────────────────────────────────────────────────
 * 例示テストは「人が思いついた入力」しか通らない。距離計算の壊れ方は
 * **人が思いつかない入力**（日付変更線を跨ぐ・極付近・同一点・対蹠点）に
 * 集まるので、性質を書いて総当たりさせるほうが向いている。
 *
 * 書くのは「どんな入力でもこうであるはず」という不変条件だけ。期待値を
 * 並べるのではなく、**壊れていたら成り立たない関係**を書く。
 *
 * ただし性質だけでは「常に 0 を返す実装」も通る。目盛りは独立に導出した
 * 式（球面三角法の余弦定理）との突き合わせで固定する——**暗記した距離を
 * 書かない**。実際、最初に書いた那覇の参照値 1553km は誤りで、
 * 正しくは 1558.7km だった（コードではなくテストのほうが間違っていた）。
 */

/** 実在しうる座標。NaN は入力側で弾かれる前提なので生成しない。 */
const lat = () => fc.double({ min: -90, max: 90, noNaN: true })
const lng = () => fc.double({ min: -180, max: 180, noNaN: true })
/** 日本国内。実運用の入力域はここに収まる。 */
const jpLat = () => fc.double({ min: 24, max: 46, noNaN: true })
const jpLng = () => fc.double({ min: 123, max: 146, noNaN: true })

const RUNS = { numRuns: 20_000 }

/**
 * 独立に導出した距離（球面三角法の余弦定理）。**haversine とは別の代数**。
 * 同じ球面モデルの別式なので、両者が一致すれば実装の取り違えは無いと言える。
 * 近距離では桁落ちするため、遠距離の突き合わせ専用。
 */
function lawOfCosinesKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r)
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r)
  return 6371 * Math.acos(Math.min(1, Math.max(-1, c)))
}

describe('haversineKm の不変条件', () => {
  it('★常に有限（NaN を返さない）', () => {
    // NaN は `distanceKm <= radiusKm` を常に false にするため、
    // **対象店舗が黙って消える**。一番たちの悪い壊れ方なのでここで止める。
    // 対蹠点付近で `Math.sqrt(1 - a)` が負になる筋を疑って探索しているが、
    // 20 万件でも再現していない（だからガードは入れていない）。
    fc.assert(fc.property(lat(), lng(), lat(), lng(), (a, b, c, d) => {
      expect(Number.isFinite(haversineKm(a, b, c, d))).toBe(true)
    }), RUNS)
  })

  it('同一点は 0', () => {
    fc.assert(fc.property(lat(), lng(), (a, b) => {
      expect(haversineKm(a, b, a, b)).toBe(0)
    }), RUNS)
  })

  it('対称（AからB と BからA は同じ）', () => {
    // 発令側と下見側で引数の順が違っても同じ店舗集合になること。
    fc.assert(fc.property(lat(), lng(), lat(), lng(), (a, b, c, d) => {
      expect(haversineKm(a, b, c, d)).toBe(haversineKm(c, d, a, b))
    }), RUNS)
  })

  it('非負で、地球の半周（約 20015km）を超えない', () => {
    fc.assert(fc.property(lat(), lng(), lat(), lng(), (a, b, c, d) => {
      const km = haversineKm(a, b, c, d)
      expect(km).toBeGreaterThanOrEqual(0)
      expect(km).toBeLessThanOrEqual(20_015.1)
    }), RUNS)
  })

  it('三角不等式が成り立つ（日本国内）', () => {
    // 実運用の入力域。ここは 1mm の誤差も許さない。
    fc.assert(fc.property(jpLat(), jpLng(), jpLat(), jpLng(), jpLat(), jpLng(),
      (a, b, c, d, e, f) => {
        const direct = haversineKm(a, b, e, f)
        const via    = haversineKm(a, b, c, d) + haversineKm(c, d, e, f)
        expect(direct).toBeLessThanOrEqual(via + 1e-6)
      }), RUNS)
  })

  it('三角不等式が成り立つ（全球・対蹠点付近の桁落ちぶんだけ緩める）', () => {
    // 全球で 1mm を要求すると落ちる。反例は (0,0)→(0,180°) を
    // (0,-0.000004°) 経由で測った場合で、破れ幅は **1.9cm**。
    // これは実装の誤りではなく **haversine 式そのものの精度限界**
    // （対蹠点付近で急激に精度が落ちる、よく知られた性質）。
    // 誤差を「無いこと」にせず、桁として明示して固定する。
    fc.assert(fc.property(lat(), lng(), lat(), lng(), lat(), lng(),
      (a, b, c, d, e, f) => {
        const direct = haversineKm(a, b, e, f)
        const via    = haversineKm(a, b, c, d) + haversineKm(c, d, e, f)
        expect(direct).toBeLessThanOrEqual(via * (1 + 1e-8) + 1e-6)
      }), RUNS)
  })

  it('★日付変更線を跨いでも「地球一周分」にならない', () => {
    // 経度差を素直に引き算する実装だと、179°E と 179°W が 358° 離れていると
    // 判定される。日本は東経なので実害は出にくいが、**出たときに気づけない**。
    fc.assert(fc.property(lat(), fc.double({ min: 0.001, max: 1, noNaN: true }), (la, d) => {
      const km = haversineKm(la, 180 - d, la, -180 + d)
      // 実際の隔たりは 2d 度ぶん。緯度が上がるほど短くなるので上界だけ見る。
      expect(km).toBeLessThanOrEqual(2 * d * 111.2 + 1e-6)
    }), RUNS)
  })

  it('緯度を固定して経度差を広げると単調に遠くなる（半周まで）', () => {
    fc.assert(fc.property(
      fc.double({ min: -60, max: 60, noNaN: true }),
      fc.double({ min: 0, max: 89, noNaN: true }),
      fc.double({ min: 0.5, max: 90, noNaN: true }),
      (la, d1, add) => {
        expect(haversineKm(la, 0, la, d1 + add)).toBeGreaterThan(haversineKm(la, 0, la, d1) - 1e-9)
      }), RUNS)
  })

  it('★半径を広げれば対象店舗は減らない（画面の説明どおりに効く）', () => {
    // 「半径 N km 以内の店舗が対象」の単調性。両ルートともこの前提で
    // `distanceKm <= radiusKm` と書いている。
    fc.assert(fc.property(
      jpLat(), jpLng(),
      fc.array(fc.tuple(jpLat(), jpLng()), { minLength: 1, maxLength: 30 }),
      fc.double({ min: 1, max: 500, noNaN: true }),
      fc.double({ min: 0, max: 2000, noNaN: true }),
      (cLat, cLng, stores, r, add) => {
        const within = (radius: number) => new Set(
          stores.filter(([la, ln]) => haversineKm(cLat, cLng, la, ln) <= radius)
            .map(([la, ln]) => `${la},${ln}`))
        const small = within(r)
        const large = within(r + add)
        for (const s of small) expect(large.has(s), '半径を広げたのに対象から外れた店舗があります').toBe(true)
      }), { numRuns: 2_000 })
  })
})

describe('独立に導出した式との突き合わせ', () => {
  it('★球面三角法の余弦定理と一致する（遠距離）', () => {
    // 別の代数で同じ答えになること。片方だけ壊れたら気づける。
    // 近距離は余弦定理側が桁落ちするので、100km 以上のペアだけ見る。
    fc.assert(fc.property(lat(), lng(), lat(), lng(), (a, b, c, d) => {
      const h = haversineKm(a, b, c, d)
      fc.pre(h > 100)
      expect(h).toBeCloseTo(lawOfCosinesKm(a, b, c, d), 3)
    }), RUNS)
  })

  const CASES: [string, number, number, number, number][] = [
    ['東京駅 → 大阪駅', 35.6812, 139.7671, 34.7025, 135.4959],
    ['東京駅 → 那覇',   35.6812, 139.7671, 26.2124, 127.6809],
    ['東京駅 → 札幌',   35.6812, 139.7671, 43.0687, 141.3508],
  ]
  it.each(CASES)('%s も 2 つの式で一致する', (_n, la1, ln1, la2, ln2) => {
    expect(haversineKm(la1, ln1, la2, ln2)).toBeCloseTo(lawOfCosinesKm(la1, ln1, la2, ln2), 6)
  })

  it('赤道上の経度 1 度は約 111.19km（目盛りの定義）', () => {
    // 半径 6371km の球で 1 度 = 2πR/360。ここだけは定義から直に出る値。
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo((2 * Math.PI * 6371) / 360, 6)
  })
})
