/**
 * 視聴記録 (live_sessions) を利用者が書き換えられない (20261029150000_live_sessions_integrity.sql・
 * 自主診断 ASVS 16.4.2)。種は 1 つのトランザクションの中で作り、最後に取り消す。
 *
 * 実行: bunx supabase start && bunx supabase db reset && bun run test:schema-meta
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

const T = '7e100000-0000-0000-0000-0000000000a0'
const S = '7e100000-0000-0000-0000-0000000001a1'
const U = '7e100000-0000-0000-0000-000000000901'
const CAM = '7e100000-0000-0000-0000-0000000004a1'
let c: PoolClient
let sessionId = ''
let sp = 0

/** 利用者 U として 1 文を流し、行数か拒否 ('denied') を返す。毎回取り消す。 */
async function asUser(sql: string, params: unknown[] = []): Promise<number | 'denied' | Record<string, unknown>[]> {
  const name = `sp${++sp}`
  await c.query(`savepoint ${name}`)
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
    await c.query('set local role authenticated')
    const r = await c.query(sql, params)
    return r.command === 'SELECT' || /returning/i.test(sql) ? r.rows : (r.rowCount ?? 0)
  } catch (e) {
    if ((e as { code?: string }).code === '42501') return 'denied'
    throw e
  } finally {
    await c.query(`rollback to savepoint ${name}`)
    await c.query('reset role')
  }
}

beforeAll(async () => {
  c = await pool.connect()
  await c.query('begin')
  await c.query(`insert into public.tenants(id, name, plan) values ($1, 'T', 'standard')`, [T])
  await c.query(`insert into public.stores(id, tenant_id, name) values ($1, $2, 'S')`, [S, T])
  await c.query(`insert into auth.users(id) values ($1)`, [U])
  await c.query(`insert into public.admin_users(auth_user_id, role, tenant_id, store_ids) values ($1, 'viewer', $2, array[$3]::uuid[])`, [U, T, S])
  const { rows } = await c.query(
    `insert into public.live_sessions(user_id, store_id, camera_id, mode, started_at)
     values ($1, $2, $3, 'live', now() - interval '10 minutes') returning id`, [U, S, CAM])
  sessionId = rows[0].id
})

afterAll(async () => {
  await c?.query('rollback').catch(() => {})
  c?.release()
  await pool.end()
})

describe('視聴記録の守り (16.4.2)', () => {
  it('利用者は視聴記録の行を直接作れない (上限の判定を通らない偽の記録)', async () => {
    expect(await asUser(
      `insert into public.live_sessions(user_id, store_id, mode) values ($1, $2, 'live')`, [U, S])).toBe('denied')
  })

  it('始まりの時刻・カメラ・店舗は変えられない', async () => {
    expect(await asUser(`update public.live_sessions set started_at = now() where id = $1`, [sessionId])).toBe('denied')
    expect(await asUser(`update public.live_sessions set store_id = store_id, mode = 'vod' where id = $1`, [sessionId])).toBe('denied')
  })

  it('終わりはサーバの時計で決まり、送った長さは使わない', async () => {
    const rows = await asUser(
      `update public.live_sessions set ended_at = now() - interval '9 minutes', duration_sec = 1
        where id = $1 returning duration_sec, ended_at > now() - interval '1 minute' as ended_now`, [sessionId]) as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0].ended_now).toBe(true)
    expect(Number(rows[0].duration_sec)).toBeGreaterThanOrEqual(599)
  })

  it('SFU の部屋の名前は自分のカメラのものだけ', async () => {
    expect(await asUser(`update public.live_sessions set livekit_room = 'cam_other' where id = $1`, [sessionId])).toBe('denied')
    expect(await asUser(`update public.live_sessions set livekit_room = $2 where id = $1`, [sessionId, `cam_${CAM}`])).toBe(1)
  })
})
