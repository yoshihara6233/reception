/**
 * 同時視聴上限を、**実際に動いているサーバへ同時に投げて**確かめる。
 *
 * ── なぜ「同時に」でなければならないか ────────────────────────────────
 * 上限の類は 1 本ずつ叩けば必ず正しく見える。壊れるのは同時に来たときで、
 * 単体テストも他の E2E も 1 本ずつしか叩かないので、この層に穴が残っていた。
 *
 * 2026-08-10 にここを測って分かったこと:
 *   ・同時視聴上限は**本番で一度も発動していなかった**。競合ではなく、
 *     件数を数える問い合わせ自体が常に 400 で、error を捨てていたため
 *     「0 件」として素通りしていた（詳細は
 *     supabase/migrations/20260810050000_start_live_session.sql）。
 *   ・拒否が起きないので 429 も metric も出ず、**画面上は「上限に達して
 *     いない」ようにしか見えなかった**。
 *
 * DB 側の契約は tests/schema-meta/concurrency.test.ts が固定している。
 * こちらはその手前——middleware・cookie 認証・PostgREST を通した**実物**が
 * 同じ答えを返すかを見る。
 */
import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { storageStatePath } from './personas'

/** seed.example.sql の A1 店舗（テナント A）。 */
const STORE_A1_ID = '00000000-0000-0000-0000-0000000000c1'
const TENANT_A_ID = '00000000-0000-0000-0000-0000000000b1'
/** seed は session_limits を作らないので、関数側の既定値が効く。 */
const DEFAULT_MAX_CONCURRENT = 5
/** 同時に投げる本数。上限より十分多くする。 */
const BURST = 20

const DB_URL = process.env.SUPABASE_DB_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DB_URL })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

/** 上限はテナント単位なので、掃除も数えるのもテナント単位。 */
async function clearTenantSessions(): Promise<void> {
  await withDb((c) => c.query(
    `delete from public.live_sessions ls
      using public.stores s
      where s.id = ls.store_id and s.tenant_id = $1`, [TENANT_A_ID]))
}

async function activeCount(): Promise<number> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select count(*)::int as n
         from public.live_sessions ls join public.stores s on s.id = ls.store_id
        where s.tenant_id = $1 and ls.ended_at is null and ls.mode in ('live','vod')`,
      [TENANT_A_ID])
    return (rows[0] as { n: number }).n
  })
}

/** 落ちたときに「何が返ってきたか」が一目で分かるように内訳を添える。 */
const tally = (codes: number[]): string =>
  [...new Set(codes)].sort().map((c) => `${c}×${codes.filter((x) => x === c).length}`).join(' ')

test.describe('同時視聴上限（A1 店長）', () => {
  // このファイルの中では直列。ただし**別ファイルは別ワーカーで並走する**ので、
  // テナント A のセッションを作る spec を新設したらここが揺れる。
  // beforeEach の「掃除後は 0 件」がその番人（下記）。
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: storageStatePath('storeA1') })

  test.beforeEach(async () => {
    await clearTenantSessions()
    expect(
      await activeCount(),
      '掃除した直後にテナントAのセッションがあります。'
      + '他の spec が /api/sessions を叩いているなら、上限はテナント単位で数えるため'
      + 'このファイルと並走させられません。',
    ).toBe(0)
  })
  test.afterAll(clearTenantSessions)

  const start = (mode: 'grid' | 'live' | 'vod') =>
    ({ action: 'start', mode, storeId: STORE_A1_ID })

  test(`★${BURST} 本同時に開始しても、通るのはちょうど ${DEFAULT_MAX_CONCURRENT} 本`, async ({ request }) => {
    const res = await Promise.all(
      Array.from({ length: BURST }, () => request.post('/api/sessions', { data: start('live') })))
    const codes = res.map((r) => r.status())

    expect(new Set(codes), `想定外のステータス: ${tally(codes)}`).toEqual(new Set([200, 429]))
    expect(codes.filter((c) => c === 200), `上限を超えて通っています: ${tally(codes)}`)
      .toHaveLength(DEFAULT_MAX_CONCURRENT)
    expect(codes.filter((c) => c === 429)).toHaveLength(BURST - DEFAULT_MAX_CONCURRENT)

    // 返ってきたステータスだけでなく**実際に出来た行**を数える。
    // 「断ったつもりで入っている」を見逃さないため。
    expect(await activeCount(), '応答と実際の行数がずれています').toBe(DEFAULT_MAX_CONCURRENT)
  })

  test('断るときは理由と現在値を返す（画面で説明できる）', async ({ request }) => {
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      expect((await request.post('/api/sessions', { data: start('live') })).status()).toBe(200)
    }
    const res = await request.post('/api/sessions', { data: start('live') })
    expect(res.status()).toBe(429)
    expect(await res.json()).toMatchObject({
      error: 'session_limit_reached',
      limit: DEFAULT_MAX_CONCURRENT,
      active: DEFAULT_MAX_CONCURRENT,
    })
  })

  test('終了すれば枠が空く（一度埋まったら戻らない、にしない）', async ({ request }) => {
    const ids: string[] = []
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      const r = await request.post('/api/sessions', { data: start('live') })
      ids.push((await r.json()).id as string)
    }
    expect((await request.post('/api/sessions', { data: start('live') })).status()).toBe(429)

    const ended = await request.post('/api/sessions', { data: { action: 'end', id: ids[0] } })
    expect(ended.status()).toBe(200)

    expect((await request.post('/api/sessions', { data: start('live') })).status(),
      '終了しても枠が戻っていません').toBe(200)
  })

  test('grid は上限の対象外（スナップ合成は安価なので数えない）', async ({ request }) => {
    const res = await Promise.all(
      Array.from({ length: BURST }, () => request.post('/api/sessions', { data: start('grid') })))
    const codes = res.map((r) => r.status())
    expect(codes.filter((c) => c === 429), `grid が上限に巻き込まれています: ${tally(codes)}`)
      .toHaveLength(0)
    expect(codes.filter((c) => c === 200), `全部通るはずです: ${tally(codes)}`).toHaveLength(BURST)
    // grid は継続分数の対象外なので null が返る契約。
    expect((await res[0].json()).maxSessionMin).toBeNull()
  })

  test('他テナントの店舗では作れない（枠を消費させない）', async ({ request }) => {
    // 旧実装は storeId を無検証で受けており、他テナントの枠を減らせた。
    const B1 = '00000000-0000-0000-0000-0000000000c3'
    const res = await request.post('/api/sessions', {
      data: { action: 'start', mode: 'live', storeId: B1 },
    })
    expect(res.status()).toBe(403)
    expect(await activeCount(), '他テナントの操作でテナントAの枠が減っています').toBe(0)
  })
})
