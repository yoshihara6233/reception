/**
 * PostgREST の埋め込みが**解決できる形になっているか**の棚卸し。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * PostgREST は埋め込みの相手を**外部キーから探す**。外部キーが無いと
 * PGRST200 を返して 400 になるが、呼び出し側が
 *
 *     const { count } = await svc.from('live_sessions')
 *       .select('id, stores!inner(tenant_id)', { count: 'exact', head: true })
 *
 * のように error を受け取らずに書いていると、**count は null → 0 として
 * 素通りする**。2026-08-10 に測って分かったのがまさにこれで、
 * live_sessions は月次パーティション化した時点で stores への外部キーを
 * 失っており、同時視聴上限が本番で一度も発動していなかった。
 *
 * ── 一度作り直している ──────────────────────────────────────────────────
 * 最初の実装は `名前!inner` という**表記**だけを目で拾って 5 組としていた。
 * しかし `!inner` が付かない素の埋め込み（`stores ( name )`）も同じく
 * 外部キーに依存する——**危険度は表記と関係が無い**。実測すると
 * **49 箇所・20 組**あり、4 分の 3 を見落としていた。走査範囲も `src/` だけで、
 * `supabase/functions/`（J-Alert ポーラー）が丸ごと外れていた。
 *
 * 抽出は embed-scan.ts に分け、パーサ自体にもテストを書いた。
 * **取りこぼしは「0 件」という正しく見える結果を返す**ので、
 * 抽出そのものを疑う必要がある。
 *
 * REST を叩かず pg_constraint を見るのは、鍵を渡さずに CI で回せるから。
 * 見ているのは PostgREST が探すのと同じ関係そのもの。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { scanSource, uniquePairs } from '../../src/lib/ops/embed-scan'
import { EMBED_PAIRS } from '../../src/lib/ops/schema-invariants'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
afterAll(async () => { await pool.end() })

const ROOT = process.cwd()
/** アプリ側と Edge Function の両方。**片方だけ見ると片方が丸ごと外れる。** */
const SCAN_DIRS = ['src', 'supabase/functions']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []
  })
}

/** ソースに実在する埋め込みの組（テストファイルは除く）。 */
function pairsInSource(): string[] {
  const embeds = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .flatMap((p) => scanSource(readFileSync(p, 'utf8')))
  return uniquePairs(embeds)
}

describe('埋め込みの棚卸し', () => {
  it('走査対象のファイルが十分にある（黙って 0 件にならない）', () => {
    // ディレクトリ名を間違えても walk は空を返すだけ。**空を緑と読み違えない**。
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
    expect(files.length, '走査ファイルが少なすぎます').toBeGreaterThan(300)
  })

  it('ソースの埋め込みはすべて台帳に載っている（載せ忘れたら落ちる）', () => {
    const inSource = pairsInSource()
    const inTable = uniquePairs(EMBED_PAIRS.map((p) => ({ parent: p.from, child: p.to })))
    expect(inSource.length, '埋め込みを 1 つも拾えていません').toBeGreaterThan(10)
    expect(
      inSource,
      'EMBED_PAIRS（src/lib/ops/schema-invariants.ts）と実際のソースがずれています。'
      + '日次の本番監視も同じ台帳を見るので、ここがずれると監視の範囲もずれます。',
    ).toEqual(inTable)
  })

  it('★埋め込みの相手に外部キーが実在する（無いと 400 が握り潰される）', async () => {
    const missing: string[] = []
    for (const e of EMBED_PAIRS) {
      const { rows } = await pool.query(
        `select 1 from pg_constraint
          where contype = 'f'
            and ((conrelid = to_regclass($1) and confrelid = to_regclass($2))
              or (conrelid = to_regclass($2) and confrelid = to_regclass($1)))`,
        [`public.${e.from}`, `public.${e.to}`],
      )
      if (rows.length === 0) missing.push(`${e.file}: ${e.from} → ${e.to}`)
    }
    expect(missing, '外部キーが無いので PostgREST は 400 を返します').toEqual([])
  })

  it('台帳の表がすべて実在する', async () => {
    const names = [...new Set(EMBED_PAIRS.flatMap((p) => [p.from, p.to]))]
    const { rows } = await pool.query(
      `select n from unnest($1::text[]) n where to_regclass('public.' || n) is null`, [names])
    expect(rows.map((r) => (r as { n: string }).n), '台帳に実在しない表があります').toEqual([])
  })
})

describe('パーティション表の落とし穴', () => {
  it('★パーティション表を埋め込みに使っていない', async () => {
    // パーティション表は外部キーを失いやすい（live_sessions は実際に失っていた）。
    // 上の外部キー検査でも落ちるが、**なぜ落ちたのか**がここを見れば分かる。
    const { rows } = await pool.query(
      `select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind = 'p'`,
    )
    const partitioned = new Set((rows as { relname: string }[]).map((r) => r.relname))
    expect(partitioned.size, 'パーティション表を 1 つも拾えていません').toBeGreaterThan(0)
    const used = EMBED_PAIRS.filter((e) => partitioned.has(e.from) || partitioned.has(e.to))
    expect(
      used.map((e) => `${e.file}: ${e.from} → ${e.to}`),
      'パーティション表を埋め込むと外部キー不在で 400 になります。素の SQL（DB 関数）で数えてください',
    ).toEqual([])
  })
})
