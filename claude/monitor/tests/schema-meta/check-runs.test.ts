import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

/**
 * 実行記録と鮮度の見張り。**「通知が来ない」を「正常」と読めるようにする**仕掛け。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * 日次点検は問題があったときだけ鳴る。つまり沈黙が 5 通りの意味を持っていた
 * （正常／CRON_SECRET 未設定／認証失敗／RPC 失敗／cron が動いていない）。
 * 2026-08-12 に実際に確かめようとしたところ、Vercel のログを人が掘るしか
 * 手が無かった。**2 日かけて潰した「壊れているのに正常と区別が付かない」形を、
 * 監視自身が持っていた。**
 *
 * ここで固定するのは 2 点:
 *   ① 実行が必ず 1 行残ること
 *   ② 鮮度の通知が**同時実行でも 1 本**であること
 *
 * ②が要るのは、見張り役の edge-health が **2 分間隔**だから。判定と
 * 「通知したことの記録」を分けて書くと、両方が「まだ通知していない」と
 * 判断して二重に鳴る——今週ずっと直してきた形と同じ。
 */

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 16,
})

const CHECK = 'test-check-20260812'
const ALERT = `alert:${CHECK}`

beforeAll(async () => {
  const { rows } = await pool.query(
    `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname in ('record_check_run', 'claim_stale_check_alert')`)
  // 関数が無い DB では全部通ってしまう。**空を緑と読み違えない**。
  expect(rows, 'record_check_run / claim_stale_check_alert がありません').toHaveLength(2)
})

afterEach(async () => {
  await pool.query('delete from public.ops_check_runs where check_name in ($1, $2)', [CHECK, ALERT])
})
afterAll(async () => {
  await pool.query('delete from public.ops_check_runs where check_name in ($1, $2)', [CHECK, ALERT])
  await pool.end()
})

const claim = (maxAge = '26 hours', cooldown = '6 hours') =>
  pool.query('select * from public.claim_stale_check_alert($1, $2::interval, $3::interval)',
    [CHECK, maxAge, cooldown])

async function rows(name: string) {
  const { rows: r } = await pool.query(
    'select severity, problems, duration_ms from public.ops_check_runs where check_name = $1 order by id',
    [name])
  return r as { severity: string; problems: string[]; duration_ms: number | null }[]
}

describe('record_check_run', () => {
  it('正常な実行も 1 行残る（沈黙の根拠になる）', async () => {
    await pool.query('select public.record_check_run($1, $2, $3, $4)', [CHECK, 'ok', [], 123])
    expect(await rows(CHECK)).toEqual([{ severity: 'ok', problems: [], duration_ms: 123 }])
  })

  it('指摘つきの実行も残る', async () => {
    await pool.query('select public.record_check_run($1, $2, $3, $4)',
      [CHECK, 'critical', ['Vault の app_url がありません'], 456])
    const [r] = await rows(CHECK)
    expect(r.severity).toBe('critical')
    expect(r.problems).toEqual(['Vault の app_url がありません'])
  })

  it('想定外の severity は受け付けない', async () => {
    await expect(pool.query('select public.record_check_run($1, $2, $3, $4)',
      [CHECK, 'maybe', [], 1])).rejects.toMatchObject({ code: '23514' })
  })
})

describe('claim_stale_check_alert', () => {
  it('直近に実行があれば古くない・通知しない', async () => {
    await pool.query('select public.record_check_run($1, $2, $3, $4)', [CHECK, 'ok', [], 1])
    const { rows: [r] } = await claim()
    expect(r).toMatchObject({ stale: false, should_alert: false })
    expect(r.last_ran_at).toBeTruthy()
  })

  it('★記録が 1 件も無ければ古い扱い（導入直後も未実行も同じ）', async () => {
    const { rows: [r] } = await claim()
    expect(r.stale).toBe(true)
    expect(r.last_ran_at).toBeNull()
    expect(r.should_alert).toBe(true)
  })

  it('★max_age を過ぎた実行は古い', async () => {
    await pool.query('select public.record_check_run($1, $2, $3, $4)', [CHECK, 'ok', [], 1])
    await pool.query(
      `update public.ops_check_runs set ran_at = now() - interval '30 hours' where check_name = $1`,
      [CHECK])
    const { rows: [r] } = await claim()
    expect(r.stale).toBe(true)
    expect(r.should_alert).toBe(true)
  })

  it('★2 回目は通知しない（cooldown 中）', async () => {
    expect((await claim()).rows[0].should_alert).toBe(true)
    expect((await claim()).rows[0].should_alert, '2 分ごとに鳴り続けます').toBe(false)
    expect((await claim()).rows[0].should_alert).toBe(false)
  })

  it('cooldown を過ぎればまた通知する（直らないまま忘れられない）', async () => {
    await claim()
    await pool.query(
      `update public.ops_check_runs set ran_at = now() - interval '7 hours' where check_name = $1`,
      [ALERT])
    expect((await claim()).rows[0].should_alert).toBe(true)
  })

  it('★16 本同時でも通知は 1 本だけ', async () => {
    // 見張り役は 2 分間隔。判定と通知記録を分けて書くと二重に鳴る。
    const res = await Promise.all(Array.from({ length: 16 }, () => claim()))
    const alerts = res.filter((r) => r.rows[0].should_alert)
    expect(alerts, '同時実行で二重に通知しています').toHaveLength(1)
    expect(await rows(ALERT), '通知記録が複数あります').toHaveLength(1)
  })

  it('通知記録には最後の実行時刻が入る（メールに書ける）', async () => {
    await claim()
    const [a] = await rows(ALERT)
    expect(a.severity).toBe('critical')
    expect(a.problems[0]).toContain('一度も')
  })

  it('復旧すれば古くなくなる', async () => {
    await claim()
    await pool.query('select public.record_check_run($1, $2, $3, $4)', [CHECK, 'ok', [], 1])
    const { rows: [r] } = await claim()
    expect(r.stale).toBe(false)
    expect(r.should_alert).toBe(false)
  })
})

describe('ops_check_runs の権限', () => {
  it('RLS が有効で、読めるのは super_admin だけ', async () => {
    const { rows: [t] } = await pool.query(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'ops_check_runs'`)
    expect(t.rls, 'RLS が無効です').toBe(true)
    // SELECT の 1 本だけ。書き込みは service_role（SECURITY DEFINER 関数）経由のみ。
    expect(t.policies).toBe(1)
  })

  it('記録・判定の関数は service_role 専用', async () => {
    const { rows } = await pool.query(
      `select p.proname,
              coalesce(has_function_privilege('anon', p.oid, 'execute'), false) as anon,
              coalesce(has_function_privilege('authenticated', p.oid, 'execute'), false) as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('record_check_run', 'claim_stale_check_alert')`)
    for (const r of rows as { proname: string; anon: boolean; auth: boolean }[]) {
      expect(r.anon, `${r.proname} を anon が実行できます`).toBe(false)
      expect(r.auth, `${r.proname} を authenticated が実行できます`).toBe(false)
    }
  })
})

/**
 * NVR 時計の艦隊集計。**100 拠点を 1 つの判定に畳む**ための関数が、
 * 正しい形を返すか。ここが空を返すようになると、時計ズレは永久に
 * 検出されない（監視自身に同じ疑いをかける）。
 */
describe('nvr_clock_fleet', () => {
  it('★エッジが無くても想定した形を返す（空を緑と読み違えない）', async () => {
    const { rows } = await pool.query('select public.nvr_clock_fleet() as f')
    const f = (rows[0] as { f: Record<string, unknown> }).f
    for (const k of ['checked_at', 'edges', 'never_measured', 'stale',
                     'over_threshold', 'max_abs_sec', 'worst']) {
      expect(f, `${k} がありません`).toHaveProperty(k)
    }
    expect(Array.isArray(f.worst)).toBe(true)
  })

  it('しきい値と上限は引数で渡せる（判断は呼び出し側）', async () => {
    const { rows } = await pool.query(
      'select public.nvr_clock_fleet($1, $2, $3) as f', [30, 12, 5])
    const f = (rows[0] as { f: { warn_sec: number; stale_hours: number } }).f
    expect(f.warn_sec).toBe(30)
    expect(f.stale_hours).toBe(12)
  })

  it('service_role 以外は実行できない', async () => {
    const { rows } = await pool.query(
      `select coalesce(has_function_privilege('anon', p.oid, 'execute'), false) as anon,
              coalesce(has_function_privilege('authenticated', p.oid, 'execute'), false) as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'nvr_clock_fleet'`)
    expect(rows[0]).toEqual({ anon: false, auth: false })
  })

  it('★証跡テーブルに時刻差の列がある（後から監査・遡及補正できる）', async () => {
    // 列が無ければ「その映像が何秒ずれていたか」を永久に再現できない。
    const { rows } = await pool.query(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'clock_offset_sec'
        order by table_name`)
    expect(rows.map((r) => (r as { table_name: string }).table_name))
      .toEqual(['alarm_frames', 'bcp_clips', 'inspection_clips'])
  })
})
