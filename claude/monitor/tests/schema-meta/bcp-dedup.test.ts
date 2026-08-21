import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

/**
 * 同一地震・同一店舗で BCP が二重起動しないことを、**実際に同時に投げて**確かめる。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * jalert-poller は「既に同じ EventID の bcp_events があるか」を
 * **select してから insert** している。ところがポーラーは cron で**毎分**
 * 呼ばれ、`net.http_post` は投げっぱなしで前回の完了を待たない。
 * 1 回の処理は店舗ごとの逐次ループ（DB 書き込み＋メール送信）なので、
 * 60 秒を超えると次の実行が重なり、**両方が「まだ無い」と判断する**。
 * 同時視聴上限（tests/schema-meta/concurrency.test.ts）と同じ形。
 *
 * 結果として起きるのは、同じ発令での**二重の録画指示と二重のメール**。
 *
 * ── 直し方の選択 ────────────────────────────────────────────────────────
 * ポーラー全体をリースで直列化する案は、異常終了でリースを握ったまま
 * 止まると**発令が遅れる**——災害通知で避けるべきは取りこぼしのほうなので、
 * 取りこぼす方向の失敗モードを新たに作らない一意索引を選んだ。
 *
 * ここで固定するのは「同時に来ても 1 件しか作られない」。これは
 * 1 本ずつ叩くテストでは決して落ちないので、**同時に投げること自体が本体**。
 */

const N = 12
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: N + 4,
})

/** このファイル専用の固定 UUID。 */
const TENANT = '00000000-0000-0000-0000-0000000000ea'
const STORE  = '00000000-0000-0000-0000-0000000000eb'
const EVENT_ID = 'test-jma-event-20260810'

beforeAll(async () => {
  const { rows } = await pool.query(
    `select indexdef from pg_indexes where indexname = 'bcp_events_store_alert_event_uniq'`)
  // 索引が無い DB で走らせると全部通ってしまう。**空を緑と読み違えない**。
  expect(rows, '一意索引がありません。db reset を実行してください').toHaveLength(1)

  await pool.query(
    `insert into public.tenants (id, name, plan, status) values ($1, 'BCP重複テスト', 'standard', 'active')
       on conflict (id) do nothing`, [TENANT])
  await pool.query(
    `insert into public.stores (id, tenant_id, name) values ($1, $2, 'BCP重複テスト店舗')
       on conflict (id) do nothing`, [STORE, TENANT])
})

afterEach(async () => {
  await pool.query('delete from public.bcp_events where store_id = $1', [STORE])
})

afterAll(async () => {
  await pool.query('delete from public.bcp_events where store_id = $1', [STORE])
  await pool.query('delete from public.tenants where id = $1', [TENANT])
  await pool.end()
})

/** ポーラーが実際に入れる形の 1 行。 */
function insertEvent(over: Record<string, unknown> = {}) {
  const row = {
    store_id: STORE,
    alert_source: `urn:uuid:${Math.random()}`,   // 電文ごとに異なる＝これでは重複を防げない
    alert_type: 'earthquake',
    alert_issued_at: '2026-08-10T03:02:00Z',
    jma_event_id: EVENT_ID,
    status: 'pending',
    is_test: false,
    ...over,
  }
  return pool.query(
    `insert into public.bcp_events
       (store_id, alert_source, alert_type, alert_issued_at, jma_event_id, status, is_test)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [row.store_id, row.alert_source, row.alert_type, row.alert_issued_at,
     row.jma_event_id, row.status, row.is_test],
  )
}

async function countEvents(): Promise<number> {
  const { rows } = await pool.query(
    'select count(*)::int as n from public.bcp_events where store_id = $1', [STORE])
  return (rows[0] as { n: number }).n
}

describe('BCP の二重起動', () => {
  it(`★${N} 本同時に来ても作られるのは 1 件だけ`, async () => {
    const res = await Promise.allSettled(Array.from({ length: N }, () => insertEvent()))
    const ok = res.filter((r) => r.status === 'fulfilled')
    const rejected = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

    expect(ok, '同じ地震で複数の BCP が起動しています').toHaveLength(1)
    expect(await countEvents(), '応答と実際の行数がずれています').toBe(1)
    // 落ちた側は必ず unique_violation。別の理由で落ちているなら設計の想定外。
    for (const r of rejected) {
      expect((r.reason as { code?: string }).code, '想定外のエラーで落ちています').toBe('23505')
    }
  })

  it('続報（alert_source が違う電文）でも 1 件のまま', async () => {
    // 震度速報 → 震源に関する情報 → 震源・震度情報、と同じ地震で電文が続く。
    // **alert_source は電文ごとに違う**ので、そこでは重複を防げない。
    await insertEvent()
    await expect(insertEvent()).rejects.toMatchObject({ code: '23505' })
    expect(await countEvents()).toBe(1)
  })

  it('★種別が違えば別件（地震と特別警報は同時に来る）', async () => {
    // 台風で暴風特別警報が出ている最中の地震など、別の発令として扱う。
    await insertEvent({ alert_type: 'earthquake' })
    await insertEvent({ alert_type: 'special_warning' })
    expect(await countEvents(), '種別違いまで抑止しています').toBe(2)
  })

  it('★EventID が無ければ抑止しない（時間窓の判定に任せる）', async () => {
    // EventID を持たない電文は一意制約で表現できない。ここを抑止すると、
    // **別々の発令が 1 件に潰れて取りこぼす**。
    await insertEvent({ jma_event_id: null })
    await insertEvent({ jma_event_id: null })
    expect(await countEvents(), 'EventID 無しを誤って抑止しています').toBe(2)
  })

  it('★テスト発令は抑止しない（/api/bcp/test を塞がない）', async () => {
    await insertEvent({ is_test: true })
    await insertEvent({ is_test: true })
    expect(await countEvents(), 'テスト発令を抑止しています').toBe(2)
  })

  it('店舗が違えば別件（1 つの地震で複数店舗が発動する）', async () => {
    const other = '00000000-0000-0000-0000-0000000000ec'
    await pool.query(
      `insert into public.stores (id, tenant_id, name) values ($1, $2, 'BCP重複テスト店舗2')
         on conflict (id) do nothing`, [other, TENANT])
    await insertEvent()
    await insertEvent({ store_id: other })
    const { rows } = await pool.query(
      'select count(*)::int as n from public.bcp_events where store_id in ($1, $2)', [STORE, other])
    expect((rows[0] as { n: number }).n, '店舗違いまで抑止しています').toBe(2)
    await pool.query('delete from public.bcp_events where store_id = $1', [other])
    await pool.query('delete from public.stores where id = $1', [other])
  })
})
