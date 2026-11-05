/**
 * tenants の RLS (20261105090000_tenants_rls_fix.sql)。
 *
 * 以前のポリシー tenant_isolation は auth_role()・auth_tenant_id() で判定していたが、この 2 つは
 * JWT に無い claim (raw_app_meta_data) を読んでいて誰に対しても NULL を返し、利用者の接続では
 * tenants が 1 行も読めなかった (自分のテナントも)。直したあとの形を固定する。
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

const T_A = '7e300000-0000-0000-0000-0000000000a1'
const T_B = '7e300000-0000-0000-0000-0000000000b1'
const U = {
  tenantAdmin: '7e300000-0000-0000-0000-000000000901',
  storeManager: '7e300000-0000-0000-0000-000000000902',
  viewer:      '7e300000-0000-0000-0000-000000000903',
  baggage:     '7e300000-0000-0000-0000-000000000904',
  superAdmin:  '7e300000-0000-0000-0000-000000000905',
}

async function seed(c: PoolClient) {
  await c.query(`insert into public.tenants(id, name, plan, status) values ($1, 'RLS-A', 'standard', 'active'), ($2, 'RLS-B', 'standard', 'active')`, [T_A, T_B])
  for (const id of Object.values(U)) await c.query(`insert into auth.users(id) values ($1)`, [id])
  await c.query(
    `insert into public.admin_users(auth_user_id, role, tenant_id) values
       ($1, 'tenant_admin', $6), ($2, 'store_manager', $6), ($3, 'viewer', $6), ($4, 'baggage_manager', $6), ($5, 'super_admin', null)`,
    [U.tenantAdmin, U.storeManager, U.viewer, U.baggage, U.superAdmin, T_A],
  )
}

/** その人の接続 (aal2) で SQL を流す。失敗しても外のトランザクションを壊さない。 */
async function asUser<T>(c: PoolClient, sub: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await c.query('savepoint s')
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2' })])
    await c.query('set local role authenticated')
    return (await c.query(sql, params)).rows as T[]
  } finally {
    await c.query('rollback to savepoint s')
    await c.query('reset role')
  }
}

const visibleNames = (c: PoolClient, sub: string) =>
  asUser<{ name: string }>(c, sub, `select name from public.tenants where id in ($1, $2) order by name`, [T_A, T_B])
    .then((rows) => rows.map((r) => r.name))

describe('tenants の RLS', () => {
  it('★テナントの利用者は自分のテナントだけ読める (以前は 0 行)', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      for (const sub of [U.tenantAdmin, U.storeManager, U.viewer, U.baggage]) {
        expect(await visibleNames(c, sub), sub).toEqual(['RLS-A'])
      }
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('全体管理者は全テナントを読める', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      expect(await visibleNames(c, U.superAdmin)).toEqual(['RLS-A', 'RLS-B'])
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('★利用者の接続では書けない (書き込みはサービスの接続だけ)', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      for (const sub of [U.tenantAdmin, U.superAdmin]) {
        const updated = await asUser<{ id: string }>(c, sub, `update public.tenants set name = 'x' where id = $1 returning id`, [T_A])
        expect(updated, sub).toEqual([])
        const deleted = await asUser<{ id: string }>(c, sub, `delete from public.tenants where id = $1 returning id`, [T_A])
        expect(deleted, sub).toEqual([])
      }
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('許すポリシーは tenants_select (読むだけ・authenticated) の 1 本だけ', async () => {
    const { rows } = await pool.query<{ polname: string; polcmd: string; roles: string }>(
      `select p.polname, p.polcmd::text as polcmd,
              array_to_string(array(select rolname from pg_roles where oid = any(p.polroles) order by 1), ',') as roles
         from pg_policy p
        where p.polrelid = 'public.tenants'::regclass and p.polpermissive`,
    )
    expect(rows).toEqual([{ polname: 'tenants_select', polcmd: 'r', roles: 'authenticated' }])
  })

  it('★壊れていた auth_role()・auth_tenant_id() は残っていない (中身だけ直すと FOR ALL のポリシーが開くため)', async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('auth_role', 'auth_tenant_id')`,
    )
    expect(rows).toEqual([])
  })
})
