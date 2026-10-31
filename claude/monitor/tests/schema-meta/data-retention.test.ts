/**
 * 保持期間の時刻をサーバが書く (20261030150000_data_retention.sql・2026-10-30 発注者の決定)。
 * 種は 1 つのトランザクションの中で作り、最後に取り消す。
 *
 *   ★登録を外すと deactivated_at が入り、戻すと消える
 *   ★顔を登録し直すと face_last_matched_at がその時刻になる (1 年を数え直す)
 *   ★利用者の接続からは 2 つの時刻を変えられない (期限を延ばす・早めることを防ぐ)
 *   ★BCP の生画像を消した印は、利用者・エッジの接続から外せない
 *
 * 実行: bunx supabase start && bunx supabase db reset && bun run test:schema-meta
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

const T = '7e900000-0000-0000-0000-0000000000a0'
const S = '7e900000-0000-0000-0000-0000000000b0'
const U = '7e900000-0000-0000-0000-000000000901'
const E1 = '7e900000-0000-0000-0000-000000000001'
const E2 = '7e900000-0000-0000-0000-000000000002'
const EV = '7e900000-0000-0000-0000-0000000000e1'
let c: PoolClient
let sp = 0

/** 利用者 U (テナント T の管理者) として 1 文を流す。通れば残し (変わらないことを後で確かめる)、断られたら取り消す。 */
async function asUser(sql: string, params: unknown[] = []): Promise<void> {
  const name = `sp${++sp}`
  await c.query(`savepoint ${name}`)
  try {
    // employees の許可のポリシー (employee_isolation) は JWT の raw_app_meta_data.tenant_id を見る
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U, role: 'authenticated', aal: 'aal2', raw_app_meta_data: { tenant_id: T } })])
    await c.query('set local role authenticated')
    await c.query(sql, params)
    await c.query('reset role')
    await c.query(`release savepoint ${name}`)
  } catch {
    await c.query(`rollback to savepoint ${name}`) // RLS で断られても良い (変えられないことを確かめる)
    await c.query('reset role')
  }
  // 以降の文をサーバ (postgres) として流すため、利用者の印を外す
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0]

beforeAll(async () => {
  c = await pool.connect()
  await c.query('begin')
  await c.query(`insert into public.tenants(id, name, plan, status) values ($1, 'T', 'standard', 'active')`, [T])
  await c.query(`insert into public.stores(id, tenant_id, name) values ($1, $2, 'S')`, [S, T])
  await c.query(`insert into auth.users(id) values ($1)`, [U])
  await c.query(`insert into public.admin_users(auth_user_id, role, tenant_id) values ($1, 'tenant_admin', $2)`, [U, T])
  await c.query(
    `insert into public.employees(id, tenant_id, store_id, name, qr_code, status, rekognition_face_id)
     values ($1, $3, $4, '甲', 'q-7e9-1', 'active', 'face-1'), ($2, $3, $4, '乙', 'q-7e9-2', 'active', null)`,
    [E1, E2, T, S])
})

afterAll(async () => {
  await c.query('rollback')
  c.release()
  await pool.end()
})

describe('従業員の保持期間の時刻', () => {
  it('★顔のある行を作ると face_last_matched_at が入る', async () => {
    const r = await one(`select face_last_matched_at is not null as has from public.employees where id = $1`, [E1])
    expect(r.has).toBe(true)
  })

  it('★顔を登録し直すと、そこから 1 年を数え直す', async () => {
    await c.query(`update public.employees set face_last_matched_at = now() - interval '2 years' where id = $1`, [E1])
    await c.query(`update public.employees set rekognition_face_id = 'face-1b' where id = $1`, [E1])
    const r = await one(`select face_last_matched_at = now() as fresh from public.employees where id = $1`, [E1])
    expect(r.fresh).toBe(true)
  })

  it('★登録を外すと deactivated_at が入り、戻すと消える', async () => {
    await c.query(`update public.employees set status = 'inactive' where id = $1`, [E2])
    expect((await one(`select deactivated_at = now() as stamped from public.employees where id = $1`, [E2])).stamped).toBe(true)
    await c.query(`update public.employees set status = 'active' where id = $1`, [E2])
    expect((await one(`select deactivated_at from public.employees where id = $1`, [E2])).deactivated_at).toBeNull()
    await c.query(`update public.employees set status = 'inactive' where id = $1`, [E2])
  })

  it('★利用者の接続からは 2 つの時刻を変えられない (ほかの列の更新は届く)', async () => {
    const before = await one(`select deactivated_at, face_last_matched_at from public.employees where id = $1`, [E2])
    await asUser(
      `update public.employees set name = '乙2', deactivated_at = now() - interval '5 years', face_last_matched_at = now() + interval '5 years' where id = $1`,
      [E2])
    const after = await one(`select name, deactivated_at, face_last_matched_at from public.employees where id = $1`, [E2])
    expect(after.name).toBe('乙2') // 更新そのものは通った (RLS で断られて素通りしたのではない)
    expect({ deactivated_at: after.deactivated_at, face_last_matched_at: after.face_last_matched_at }).toEqual(before)
  })
})

describe('BCP の生画像を消した印', () => {
  it('★利用者・エッジの接続からは外せない (サーバは書ける)', async () => {
    await c.query(`insert into public.bcp_events(id, store_id, alert_issued_at) values ($1, $2, now())`, [EV, S])
    await c.query(`update public.bcp_events set raw_purged_at = now() where id = $1`, [EV])
    await asUser(`update public.bcp_events set raw_purged_at = null where id = $1`, [EV])
    expect((await one(`select raw_purged_at is not null as kept from public.bcp_events where id = $1`, [EV])).kept).toBe(true)
  })
})
