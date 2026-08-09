/**
 * RLS のメタ検査 — **本番と同じ migration を当てた DB のカタログを直接見る**。
 *
 * ── tests/authz/ との違い ──────────────────────────────────────────────
 * authz（63件）は「このロールでこの行が見えるか」を 1 テーブルずつ確かめる。
 * 手で書いたペルソナの数だけ守れるが、**書き忘れたテーブルは誰も見ない**。
 * こちらは逆で、中身は問わず「全部を数える」。新しいテーブルを RLS 無しで
 * 追加したら、テストを 1 行も書かなくても落ちる。
 *
 * もう一つの違いとして、authz は tests/authz/schema.sql という**手書きの
 * 近似スキーマ**に対して走る（Postgres だけで完結させるため）。近似は
 * 本番からずれる（2026-08-09 に実際にずれていた）。ここは
 * `supabase db reset` で **本物の migration を当てた DB** に対して走らせる。
 *
 * 実行:
 *   bunx supabase start && bunx supabase db reset
 *   bun run test:rls-meta
 * CI は e2e job（同じローカル Supabase を使う）で走らせる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { rows } = await pool.query(sql)
  return rows as T[]
}

beforeAll(async () => {
  // migration が当たっていない DB に対して走らせると、全部が「テーブルが無い」
  // で通ってしまう。**空っぽを緑と読み違えない**ための最低限の確認。
  const [{ n }] = await q<{ n: string }>(
    `select count(*)::text as n from pg_class c
       join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r','p')`,
  )
  if (Number(n) < 40) {
    throw new Error(
      `public のテーブルが ${n} 件しかありません。migration が当たっていない可能性があります。\n` +
      '`bunx supabase db reset` を実行してください。',
    )
  }
})

afterAll(async () => { await pool.end() })

// ── 例外の台帳 ──────────────────────────────────────────────────────────
// **ここに足すときは理由を書く。** 「とりあえず通す」ために足された行は、
// 半年後には誰も理由を説明できなくなる。

/**
 * RLS 有効・ポリシー 0 本が**正しい**テーブル。
 * ポリシーが無い＝ service_role（rolbypassrls）以外は一切触れない、という意味。
 */
const NO_POLICY_OK = new Map<string, string>([
  ['rate_limits',
   '無認証ルートの回数カウンタ。読み書きは rate_limit_hit()（SECURITY DEFINER）経由のみ。'],
  ['baggage_kiosk_pins',
   'キオスクの PIN。API 側（requireKioskStore）でのみ検証する。利用者に直接引かせない。'],
  ['enrollment_tokens',
   'エッジ端末の登録トークン。bootstrap API だけが service role で扱う。'],
])

/**
 * パーティションは親のポリシーで守る。子に RLS を有効化したうえで
 * ポリシーを置かない＝**親経由でしか読めない**（子を直接指定しても拒否）。
 * これは意図した形なので、子は「ポリシー 0 本」の検査から外す。
 */
const PARTITION_RE = /^(live_sessions|monitor_results)_\d{6}$/

describe('RLS メタ検査: テーブル', () => {
  it('public の全テーブルで RLS が有効', async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('r','p')
          and not c.relrowsecurity
        order by c.relname`,
    )
    expect(
      rows.map((r) => r.relname),
      'RLS が無効なテーブルです。anon キーだけで中身が読めます:\n'
      + rows.map((r) => `  ${r.relname}`).join('\n'),
    ).toEqual([])
  })

  it('RLS 有効なのにポリシーが 1 本も無いテーブルは、台帳に載っているものだけ', async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('r','p')
          and c.relrowsecurity
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
        order by c.relname`,
    )
    const unexpected = rows
      .map((r) => r.relname)
      .filter((t) => !NO_POLICY_OK.has(t) && !PARTITION_RE.test(t))
    expect(
      unexpected,
      'ポリシーが無いテーブルです。service_role 専用の意図なら NO_POLICY_OK に'
      + '理由付きで登録し、そうでなければポリシーを書いてください:\n'
      + unexpected.map((t) => `  ${t}`).join('\n'),
    ).toEqual([])
  })

  it('台帳に載っているテーブルが実在する（消えた行を残さない）', async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('r','p')`,
    )
    const existing = new Set(rows.map((r) => r.relname))
    const stale = [...NO_POLICY_OK.keys()].filter((t) => !existing.has(t))
    expect(stale, 'NO_POLICY_OK に残っている削除済みテーブル:\n' + stale.join('\n')).toEqual([])
  })
})

describe('RLS メタ検査: ポリシー', () => {
  it('無条件に通す SELECT ポリシーが無い', async () => {
    // `USING (true)` かつ対象ロールが PUBLIC ＝ **未認証(anon)でも読める**。
    // anon キーはブラウザに配る公開値なので、実質インターネット公開に等しい。
    // 2026-08-09、central_nodes（インフラの hostname）と nvr_models が
    // この形で残っていた（remote baseline 由来＝本番も同じ状態だった）。
    const rows = await q<{ relname: string; polname: string }>(
      `select c.relname, p.polname
         from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public'
          and p.polpermissive
          and p.polroles = '{0}'                       -- 0 = PUBLIC（全ロール）
          and pg_get_expr(p.polqual, p.polrelid) = 'true'
        order by 1, 2`,
    )
    expect(
      rows.map((r) => `${r.relname}.${r.polname}`),
      '未認証でも読めるポリシーです。to authenticated を付けるか条件を書いてください:\n'
      + rows.map((r) => `  ${r.relname}.${r.polname}`).join('\n'),
    ).toEqual([])
  })

  it('無条件に通す書き込みポリシーが無い', async () => {
    const rows = await q<{ relname: string; polname: string; polcmd: string }>(
      `select c.relname, p.polname, p.polcmd::text
         from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public'
          and p.polpermissive
          and p.polcmd in ('a','w','d','*')            -- insert/update/delete/all
          and p.polroles = '{0}'
          and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true'
          and coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
        order by 1, 2`,
    )
    expect(
      rows.map((r) => `${r.relname}.${r.polname} (${r.polcmd})`),
      '誰でも書けるポリシーです:\n' + rows.map((r) => `  ${r.relname}.${r.polname}`).join('\n'),
    ).toEqual([])
  })
})

describe('RLS メタ検査: ビュー', () => {
  it('public のビューは security_invoker が有効', async () => {
    // 既定のビューは**作成者の権限で動く**＝元テーブルの RLS を素通りする。
    // security_invoker = on にして初めて、見る人の権限で評価される。
    // 集計ビューを 1 本足しただけでテナント分離が崩れうる箇所。
    const rows = await q<{ relname: string; v: string | null }>(
      `select c.relname,
              (select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker') as v
         from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('v','m')
        order by c.relname`,
    )
    const bad = rows.filter((r) => (r.v ?? 'off').toLowerCase() !== 'true' && (r.v ?? 'off') !== 'on')
    expect(
      bad.map((r) => `${r.relname} (security_invoker=${r.v ?? '未設定'})`),
      'ビューが作成者権限で動きます＝元テーブルの RLS を迂回します:\n'
      + bad.map((r) => `  ${r.relname}`).join('\n'),
    ).toEqual([])
    // ビューが 1 本も無い状態で緑になるのを防ぐ（検査対象が消えていないか）。
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('RLS メタ検査: SECURITY DEFINER 関数', () => {
  it('search_path が固定されている', async () => {
    // 未固定の SECURITY DEFINER 関数は、**リストアを失敗させた実績がある**
    // （DR 訓練で判明）。RLS の判定そのものがこれらの関数に乗っているので、
    // 解決先がぶれると権限判定がぶれる。
    const rows = await q<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.prosecdef and p.proconfig is null
        order by p.proname`,
    )
    expect(
      rows.map((r) => r.proname),
      "search_path が未固定の SECURITY DEFINER 関数です（set search_path to 'public', 'pg_temp'）:\n"
      + rows.map((r) => `  ${r.proname}`).join('\n'),
    ).toEqual([])
  })

  it('search_path に pg_temp が含まれている', async () => {
    // `SET search_path = public` だけでは足りない。pg_temp を**明示しない**と、
    // Postgres は一時スキーマを検索順の先頭に置く（列挙した場合のみその位置になる）。
    // つまり同名の一時テーブルで参照先をすり替えられる余地が残る。
    //
    // 現状 anon / authenticated は NOLOGIN で、PostgREST 経由では DDL を
    // 実行できないため**実際に到達する経路は無い**。多層防御としての固定。
    const rows = await q<{ proname: string; cfg: string }>(
      `select p.proname, array_to_string(p.proconfig, ',') as cfg
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.prosecdef and p.proconfig is not null
        order by p.proname`,
    )
    const missing = rows.filter((r) => !/\bpg_temp\b/.test(r.cfg))
    expect(
      missing.map((r) => `${r.proname} (${r.cfg})`),
      'search_path に pg_temp がありません。一時テーブルで参照先をすり替えられる余地が残ります:\n'
      + missing.map((r) => `  ${r.proname}`).join('\n'),
    ).toEqual([])
  })
})

describe('RLS メタ検査: ロール', () => {
  it('anon / authenticated は DB へ直接ログインできない', async () => {
    // RLS を迂回する唯一の正規手段が service_role（rolbypassrls）。
    // anon / authenticated が LOGIN 可能になると、PostgREST を通さずに
    // 接続されうる（＝アプリ側のガードが全部無関係になる）。
    const rows = await q<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean }>(
      `select rolname, rolcanlogin, rolbypassrls from pg_roles
        where rolname in ('anon', 'authenticated') order by rolname`,
    )
    expect(rows.length, 'anon / authenticated が存在しません').toBe(2)
    for (const r of rows) {
      expect(r.rolcanlogin, `${r.rolname} が直接ログインできます`).toBe(false)
      expect(r.rolbypassrls, `${r.rolname} が RLS を迂回できます`).toBe(false)
    }
  })
})
