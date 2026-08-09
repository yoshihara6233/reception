/**
 * PostgREST の埋め込み（`親!inner(...)`）が**解決できる形になっているか**の棚卸し。
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
 * 429 も metric も出ないので、画面上は「上限に達していない」ようにしか
 * 見えない——**壊れているのに正常と区別が付かない**形だった。
 *
 * ── ここで見るもの ──────────────────────────────────────────────────────
 * src の埋め込みを全部拾い、下の棚卸し表と突き合わせたうえで、
 * **その組に外部キーが実在するか**をカタログに問う。
 * 埋め込みを増やしたら表に足すまで落ちる（＝棚卸しが古くならない）。
 *
 * REST を叩かず pg_constraint を見るのは、鍵を渡さずに CI で回せるから。
 * 見ているのは PostgREST が探すのと同じ関係そのもの。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
afterAll(async () => { await pool.end() })

const SRC = join(process.cwd(), 'src')

interface Embed {
  /** src からの相対パス */
  file: string
  /** 埋め込む側のテーブル（`from(...)` か、入れ子なら 1 つ外側の埋め込み） */
  from: string
  /** 埋め込まれる側 */
  to: string
}

/**
 * 棚卸し表。**src に出てくる埋め込みと 1 対 1 で対応する。**
 * 増やしたらここに足す。足し忘れると下の突き合わせで落ちる。
 */
const EXPECTED: Embed[] = [
  { file: 'app/stores/page.tsx',                from: 'patrol_findings',     to: 'patrol_runs' },
  { file: 'app/api/cron/baggage-daily/route.ts', from: 'inspection_settings', to: 'stores' },
  { file: 'app/api/cron/security-patrol/route.ts', from: 'security_settings', to: 'stores' },
  { file: 'app/api/cron/security-report/route.ts', from: 'security_settings', to: 'stores' },
  { file: 'app/api/baggage/settings/route.ts',  from: 'recorder_cameras',    to: 'recorders' },
  { file: 'app/api/baggage/settings/route.ts',  from: 'recorders',           to: 'edge_devices' },
  { file: 'app/admin/baggage/page.tsx',         from: 'recorder_cameras',    to: 'recorders' },
  { file: 'app/admin/baggage/page.tsx',         from: 'recorders',           to: 'edge_devices' },
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })
}

/**
 * src から `名前!inner` / `名前!left` を拾う。
 * **コメント行は除く。** 過去の実装を説明する文中に出てくるだけの表記まで
 * 拾うと、直したはずの箇所が棚卸しに戻ってきてしまう。
 */
function scanEmbeds(): { file: string; to: string }[] {
  const found: { file: string; to: string }[] = []
  for (const path of walk(SRC)) {
    const rel = relative(SRC, path)
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
      for (const m of line.matchAll(/([a-z_]+)!(?:inner|left)/g)) found.push({ file: rel, to: m[1] })
    }
  }
  return found
}

describe('埋め込みの棚卸し', () => {
  it('src の埋め込みはすべて表に載っている（載せ忘れたら落ちる）', () => {
    const key = (e: { file: string; to: string }) => `${e.file} → ${e.to}`
    const inSrc = scanEmbeds().map(key).sort()
    const inTable = EXPECTED.map(key).sort()
    expect(inSrc, '棚卸し表と src がずれています。EXPECTED を更新してください').toEqual(inTable)
  })

  it('★埋め込みの相手に外部キーが実在する（無いと 400 が握り潰される）', async () => {
    const missing: string[] = []
    for (const e of EXPECTED) {
      const { rows } = await pool.query(
        `select 1 from pg_constraint
          where contype = 'f'
            and ((conrelid = $1::regclass and confrelid = $2::regclass)
              or (conrelid = $2::regclass and confrelid = $1::regclass))`,
        [`public.${e.from}`, `public.${e.to}`],
      )
      if (rows.length === 0) missing.push(`${e.file}: ${e.from} → ${e.to}`)
    }
    expect(missing, '外部キーが無いので PostgREST は 400 を返します').toEqual([])
  })
})

describe('パーティション表の落とし穴', () => {
  it('★パーティション表を埋め込みに使っていない', async () => {
    // パーティション表は外部キーを失いやすい（live_sessions は実際に失っていた）。
    // 上の外部キー検査で拾えるが、**なぜ落ちたのか**がここを見れば分かる。
    const { rows } = await pool.query(
      `select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind = 'p'`,
    )
    const partitioned = new Set((rows as { relname: string }[]).map((r) => r.relname))
    const used = EXPECTED.filter((e) => partitioned.has(e.from) || partitioned.has(e.to))
    expect(
      used.map((e) => `${e.file}: ${e.from} → ${e.to}`),
      'パーティション表を埋め込むと外部キー不在で 400 になります。素の SQL（DB 関数）で数えてください',
    ).toEqual([])
  })
})
