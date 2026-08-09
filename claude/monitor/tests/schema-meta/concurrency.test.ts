/**
 * 同時実行の実測 — **上限が「同時に来たとき」も守られるか**を実際に並べて確かめる。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * 上限の類は「1 本ずつ叩けば正しく見える」。壊れるのは同時に来たときで、
 * 単体テストもブラウザ E2E も 1 本ずつしか叩かないので届かない。
 *
 * 2026-08-10 にここを測って、**同時視聴上限が本番で一度も発動していなかった**
 * ことが分かった（競合ではなく、判定そのものが動いていなかった。詳細は
 * 20260810050000_start_live_session.sql の冒頭）。
 *
 * ── ここで守る契約 ──────────────────────────────────────────────────────
 * 「N 本同時に来ても、通るのはちょうど上限まで」。これは 1 本ずつのテストでは
 * 決して落ちないので、**同時に投げること自体がテストの本体**。
 *
 * PostgREST 経由ではなく DB へ直に N 本繋いで投げる。間の層が勝手に直列化
 * していると「上限が効いた」のか「たまたま並ばなかった」のか区別できない。
 *
 * 実行:
 *   bunx supabase start && bunx supabase db reset
 *   bun run test:schema-meta
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

/** 同時に投げる本数。プールを下回ると「並んでいない」ので max も揃える。 */
const N = 20
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: N + 4,
})

/** このファイル専用の固定 UUID。既存データと混ざらないよう `dd` 系で採番。 */
const TENANT = '00000000-0000-0000-0000-0000000000dd'
const STORE  = '00000000-0000-0000-0000-0000000000de'
const USER   = '00000000-0000-0000-0000-0000000000df'
const MAX_CONCURRENT = 5

beforeAll(async () => {
  const [{ n }] = (await pool.query(
    `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname in ('rate_limit_hit', 'start_live_session')`,
  )).rows as { n: number }[]
  // 関数が無い DB に対して走らせると、全部が「呼べなかった」で緑になりうる。
  expect(n, 'rate_limit_hit / start_live_session が見つかりません。db reset を実行してください').toBe(2)

  await pool.query(
    `insert into public.tenants (id, name, plan, status) values ($1, '同時実行テスト', 'standard', 'active')
       on conflict (id) do nothing`, [TENANT])
  await pool.query(
    `insert into public.stores (id, tenant_id, name) values ($1, $2, '同時実行テスト店舗')
       on conflict (id) do nothing`, [STORE, TENANT])
  await pool.query(
    `insert into public.session_limits (tenant_id, max_concurrent) values ($1, $2)
       on conflict (tenant_id) do update set max_concurrent = excluded.max_concurrent`,
    [TENANT, MAX_CONCURRENT])
})

afterEach(async () => {
  await pool.query('delete from public.live_sessions where store_id = $1', [STORE])
})

afterAll(async () => {
  await pool.query('delete from public.live_sessions where store_id = $1', [STORE])
  await pool.query('delete from public.tenants where id = $1', [TENANT])  // stores/limits は cascade
  await pool.end()
})

/** N 本を**同時に**投げる。1 本ずつ await してはいけない（それでは何も測れない）。 */
function burst<T>(n: number, fn: (i: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
}

// ───────────────────────────────────────────────────────────────────────────
describe('rate_limit_hit（無認証の受け口の回数制限）', () => {
  const key = (s: string) => `test:concurrency:${s}:${process.pid}`

  it(`★${N * 3} 本同時でも通るのはちょうど上限まで`, async () => {
    const k = key('burst')
    const limit = 10
    const res = await burst(N * 3, () =>
      pool.query('select public.rate_limit_hit($1, $2, $3::interval) as allowed', [k, limit, '60 seconds']))

    const allowed = res.filter((r) => r.status === 'fulfilled' && r.value.rows[0].allowed === true).length
    const failed  = res.filter((r) => r.status === 'rejected')
    expect(failed, `${failed.length} 本が例外で落ちました`).toHaveLength(0)
    // 1文 UPSERT なので、競合しても採番は飛ばず重複もしない。
    expect(allowed, '同時実行ですり抜けています').toBe(limit)

    const [{ count }] = (await pool.query(
      'select count from public.rate_limits where key = $1', [k])).rows as { count: number }[]
    expect(count, '計上が落ちています（1文 UPSERT が壊れています）').toBe(N * 3)
  })

  it('窓を過ぎたら同時実行でもリセットは 1 回だけ', async () => {
    // 窓 0 秒＝毎回リセット対象。ここで「全員がリセットしてしまう」実装だと
    // カウンタが 1 に張り付き、制限が永久に効かなくなる。
    const k = key('reset')
    await pool.query('select public.rate_limit_hit($1, 3, $2::interval)', [k, '60 seconds'])
    await pool.query(
      `update public.rate_limits set window_start = now() - interval '2 hours' where key = $1`, [k])

    const res = await burst(N, () =>
      pool.query('select public.rate_limit_hit($1, 3, $2::interval) as allowed', [k, '1 hour']))
    const allowed = res.filter((r) => r.status === 'fulfilled' && r.value.rows[0].allowed === true).length
    expect(allowed, '窓のリセットが競合しています').toBe(3)
  })

  it('キーが違えば互いに干渉しない', async () => {
    const res = await burst(N, (i) =>
      pool.query('select public.rate_limit_hit($1, 1, $2::interval) as allowed',
        [key(`indep:${i}`), '60 seconds']))
    const allowed = res.filter((r) => r.status === 'fulfilled' && r.value.rows[0].allowed === true).length
    expect(allowed, 'キー単位になっていません').toBe(N)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('start_live_session（同時視聴上限 F-10）', () => {
  /** auth.uid() は JWT クレームから読む。接続ごとに本人を名乗らせる。 */
  async function start(mode: 'grid' | 'live' | 'vod', asUser: string = USER) {
    const client = await pool.connect()
    try {
      await client.query('select set_config($1, $2, false)',
        ['request.jwt.claims', JSON.stringify({ sub: asUser, role: 'authenticated' })])
      const { rows } = await client.query(
        'select * from public.start_live_session($1, $2)', [STORE, mode])
      return rows[0] as { session_id: string | null; active_count: number; limit_max: number; rejected: boolean }
    } finally {
      client.release()
    }
  }

  async function activeRows(): Promise<number> {
    const [{ n }] = (await pool.query(
      `select count(*)::int as n from public.live_sessions
        where store_id = $1 and ended_at is null and mode in ('live','vod')`, [STORE])).rows as { n: number }[]
    return n
  }

  it(`★${N} 本同時でも作られるのはちょうど ${MAX_CONCURRENT} 本`, async () => {
    const res = await burst(N, () => start('live'))
    const ok = res.filter((r) => r.status === 'fulfilled' && !r.value.rejected)
    const rejected = res.filter((r) => r.status === 'fulfilled' && r.value.rejected)
    const failed = res.filter((r) => r.status === 'rejected')

    expect(failed, `${failed.length} 本が例外で落ちました`).toHaveLength(0)
    expect(ok, '同時実行で上限を超えて通っています').toHaveLength(MAX_CONCURRENT)
    expect(rejected).toHaveLength(N - MAX_CONCURRENT)
    // 返り値だけでなく**実際に出来た行**を数える。ここがずれていたら
    // 「拒否したつもりで入っている」ことになる。
    expect(await activeRows(), '返り値と実際の行数がずれています').toBe(MAX_CONCURRENT)
  })

  it('通った分には id が、断った分には id が無い', async () => {
    const res = await burst(N, () => start('live'))
    const rows = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    for (const r of rows) {
      if (r.rejected) expect(r.session_id, '断ったのに id を返しています').toBeNull()
      else expect(r.session_id, '通したのに id がありません').toBeTruthy()
    }
    const ids = rows.filter((r) => r.session_id).map((r) => r.session_id)
    expect(new Set(ids).size, 'id が重複しています').toBe(ids.length)
  })

  it('grid は上限の対象外（安価なので数えない）', async () => {
    const res = await burst(N, () => start('grid'))
    const ok = res.filter((r) => r.status === 'fulfilled' && !r.value.rejected)
    expect(ok, 'grid が上限に巻き込まれています').toHaveLength(N)
  })

  it('★閉じ忘れた古いセッションでロックアウトされない', async () => {
    // 異常終了で ended_at が付かない行は必ず残る。それを永久に数え続けると、
    // そのテナントは**二度と視聴できなくなる**。6 時間より古いものは数えない。
    for (let i = 0; i < MAX_CONCURRENT + 3; i++) {
      await pool.query(
        `insert into public.live_sessions (user_id, store_id, mode, started_at)
         values ($1, $2, 'live', now() - interval '7 hours')`, [USER, STORE])
    }
    const r = await start('live')
    expect(r.rejected, '孤児セッションでロックアウトされています').toBe(false)
  })

  it('★user_id は引数ではなく auth.uid() から取る（他人になりすませない）', async () => {
    // security definer なので、user_id を引数で受けると誰のセッションでも
    // 作れてしまう。関数の中で auth.uid() を読んでいることを固定する。
    const other = '00000000-0000-0000-0000-0000000000e0'
    const r = await start('live', other)
    const [{ user_id }] = (await pool.query(
      'select user_id from public.live_sessions where id = $1', [r.session_id])).rows as { user_id: string }[]
    expect(user_id).toBe(other)
  })

  it('未ログインでは作れない', async () => {
    const client = await pool.connect()
    try {
      await client.query('select set_config($1, $2, false)', ['request.jwt.claims', ''])
      await expect(
        client.query('select * from public.start_live_session($1, $2)', [STORE, 'live']),
      ).rejects.toThrow(/unauthenticated/)
    } finally { client.release() }
  })

  it('存在しない店舗では作れない', async () => {
    await expect(start2('00000000-0000-0000-0000-0000000000ff')).rejects.toThrow(/store_not_found/)
  })

  async function start2(storeId: string) {
    const client = await pool.connect()
    try {
      await client.query('select set_config($1, $2, false)',
        ['request.jwt.claims', JSON.stringify({ sub: USER, role: 'authenticated' })])
      return await client.query('select * from public.start_live_session($1, $2)', [storeId, 'live'])
    } finally { client.release() }
  }
})
