import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { VOD_VENDORS, VOD_RANGE_MAX_MIN_BY_VENDOR, type RecorderVendor } from '../../src/lib/types/db'

/**
 * レコーダのベンダ集合が、DB とアプリでずれていないこと。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * ベンダ名は **3 箇所に別々の literal union として写経**されている:
 *   ① DB の recorders_vendor_check
 *   ② monitor の RecorderVendor（src/lib/types/db.ts）
 *   ③ edge-agent の Vendor（src/types.ts）
 *
 * ②と③はコンパイラが繋いでいないので、片方だけ足すと**登録はできるが
 * エッジが知らないベンダ**、逆なら**実装はあるが選べないベンダ**ができる。
 * 2026-08-19 に Uniview で後者の悪い形が出た——クラウドは VOD 対応として
 * 扱い UI に録画ボタンを出す一方、エッジの modes/vod.ts は弾いていた。
 * **押すまで分からない失敗**で、5 ベンダのうち 1 つが数か月その状態だった。
 *
 * ここで見られるのは ①↔② のずれまで。③ は別パッケージなので届かない
 * （単一源を @intereco/shared に移すのが本筋・別タスク）。それでも
 * 「DB に足したが型に足し忘れた」「型から消したが DB に残った」は止まる。
 */

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

afterAll(async () => { await pool.end() })

/** DB の CHECK 制約が許しているベンダ名を取り出す。 */
async function allowedInDb(): Promise<string[]> {
  const { rows } = await pool.query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'recorders'
        and c.conname = 'recorders_vendor_check'`)
  expect(rows, 'recorders_vendor_check が存在しません').toHaveLength(1)
  return [...(rows[0].def as string).matchAll(/'([^']+)'::text/g)]
    .map((m) => m[1]).sort()
}

/** アプリ側の RecorderVendor。型は実行時に読めないので、ここに写して固定する。 */
const APP_VENDORS: RecorderVendor[] = ['ipro', 'frigate', 'onvif-generic', 'i-pro-nvr']

describe('recorders.vendor', () => {
  it('★DB の CHECK 制約とアプリの RecorderVendor が一致する', async () => {
    expect(await allowedInDb()).toEqual([...APP_VENDORS].sort())
  })

  it('★Uniview は登録できない（実装が無いベンダを選ばせない）', async () => {
    // 「消したつもり」を実際に確かめる。制約だけ戻ってもここで落ちる。
    expect(await allowedInDb()).not.toContain('uniview')
  })

  it('VOD 対応ベンダは、登録できるベンダの部分集合である', async () => {
    // 登録できないベンダを VOD 対応として宣言していたら、
    // どこからも到達しない分岐を UI が持つことになる。
    for (const v of VOD_VENDORS) expect(APP_VENDORS).toContain(v)
  })

  it('VOD 対応ベンダ全部に再生時間の上限がある', () => {
    // 上限の取りこぼしは undefined 経由で「制限なし」になり、
    // エッジ側のタイムアウトまで走ってから失敗する。
    for (const v of VOD_VENDORS) {
      expect(VOD_RANGE_MAX_MIN_BY_VENDOR[v], `${v} の上限が未設定`).toBeGreaterThan(0)
    }
  })
})
