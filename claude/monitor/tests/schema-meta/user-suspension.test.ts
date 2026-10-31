/**
 * 利用者を止める・セッションを切ると DB を使えない (20261030090000_user_suspension.sql・自主診断 ASVS 7.4.2・7.4.5)。
 * 種は 1 つのトランザクションの中で作り、最後に取り消す。
 *
 * 実行: bunx supabase start && bunx supabase db reset && bun run test:schema-meta
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

afterAll(async () => { await pool.end() })

const T = '7e300000-0000-0000-0000-0000000000a0'
const U = '7e300000-0000-0000-0000-000000000901'
const S = '7e300000-0000-0000-0000-00000000c001'

/** その JWT の中身で、利用者が自分の行を何行読めるか。 */
async function ownRows(c: PoolClient, claims: Record<string, unknown>): Promise<number> {
  await c.query('savepoint s')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
  await c.query('set local role authenticated')
  const n = (await c.query(`select count(*)::int as n from public.admin_users where auth_user_id = $1`, [U])).rows[0].n
  await c.query('rollback to savepoint s')
  await c.query('reset role')
  return n
}

describe('利用者の停止とセッションの切断 (7.4.2・7.4.5)', () => {
  it('許すポリシーを持つ全部の表に user_active_only (RESTRICTIVE) がある', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and not c.relispartition
          and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                           and p.polname = 'user_active_only' and not p.polpermissive)
        order by 1`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('セッションを切ると、そのセッションのトークンでは読めない。リフレッシュトークンも消える', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(`insert into public.tenants(id, name, plan, status) values ($1, 'T', 'standard', 'active')`, [T])
      await c.query(`insert into auth.users(id) values ($1)`, [U])
      await c.query(`insert into public.admin_users(auth_user_id, role, tenant_id) values ($1, 'tenant_admin', $2)`, [U, T])
      await c.query(`insert into auth.sessions(id, user_id) values ($1, $2)`, [S, U])
      await c.query(`insert into auth.refresh_tokens(token, user_id, session_id, revoked) values ('t-7e3', $1, $2, false)`, [U, S])
      const claims = { sub: U, role: 'authenticated', aal: 'aal2', session_id: S }

      expect(await ownRows(c, claims)).toBe(1)
      const st = (await c.query(`select * from public.user_suspension_states(array[$1::uuid])`, [U])).rows[0]
      expect(st.sessions).toBe(1)
      expect(st.banned_until).toBeNull()

      const revoked = (await c.query(`select public.revoke_user_sessions($1) as n`, [U])).rows[0].n
      expect(revoked).toBe(1)
      expect((await c.query(`select count(*)::int as n from auth.refresh_tokens where user_id = $1`, [U])).rows[0].n).toBe(0)
      expect(await ownRows(c, claims)).toBe(0)
      // 形の壊れた session_id も通さない
      expect(await ownRows(c, { sub: U, role: 'authenticated', aal: 'aal2', session_id: 'x' })).toBe(0)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('止めた利用者 (ban) は読めない。戻せば読める。セッションを持たないトークンは対象外', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(`insert into public.tenants(id, name, plan, status) values ($1, 'T', 'standard', 'active')`, [T])
      await c.query(`insert into auth.users(id) values ($1)`, [U])
      await c.query(`insert into public.admin_users(auth_user_id, role, tenant_id) values ($1, 'tenant_admin', $2)`, [U, T])
      const claims = { sub: U, role: 'authenticated', aal: 'aal2' }

      expect(await ownRows(c, claims)).toBe(1)
      await c.query(`update auth.users set banned_until = now() + interval '100 years' where id = $1`, [U])
      expect(await ownRows(c, claims)).toBe(0)
      await c.query(`update auth.users set banned_until = null where id = $1`, [U])
      expect(await ownRows(c, claims)).toBe(1)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('セッションを切る・状態を見る関数は service_role だけが実行できる', async () => {
    const { rows } = await pool.query(
      `select has_function_privilege('authenticated', 'public.revoke_user_sessions(uuid)', 'execute') as a1,
              has_function_privilege('anon', 'public.revoke_user_sessions(uuid)', 'execute') as a2,
              has_function_privilege('authenticated', 'public.user_suspension_states(uuid[])', 'execute') as a3,
              has_function_privilege('anon', 'public.user_suspension_states(uuid[])', 'execute') as a4,
              has_function_privilege('service_role', 'public.revoke_user_sessions(uuid)', 'execute') as s1,
              has_function_privilege('service_role', 'public.user_suspension_states(uuid[])', 'execute') as s2`,
    )
    expect(rows[0]).toEqual({ a1: false, a2: false, a3: false, a4: false, s1: true, s2: true })
  })
})
