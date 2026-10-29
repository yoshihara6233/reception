/**
 * テナントを停止したら DB を使えない (20261029170000_tenant_suspension.sql・自主診断 ASVS 7.4.2)。
 * 種は 1 つのトランザクションの中で作り、最後に取り消す。
 *
 * 実行: bunx supabase start && bunx supabase db reset && bun run test:schema-meta
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

afterAll(async () => { await pool.end() })

describe('停止したテナント (7.4.2)', () => {
  it('許すポリシーを持つ全部の表に tenant_active_only (RESTRICTIVE) がある', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and not c.relispartition
          and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                           and p.polname = 'tenant_active_only' and not p.polpermissive)
        order by 1`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('停止したテナントの利用者は自分の行も読めず、判定の関数は真を返す。再開すれば読める', async () => {
    const c = await pool.connect()
    const T = '7e200000-0000-0000-0000-0000000000a0'
    const U = '7e200000-0000-0000-0000-000000000901'
    try {
      await c.query('begin')
      await c.query(`insert into public.tenants(id, name, plan, status) values ($1, 'T', 'standard', 'suspended')`, [T])
      await c.query(`insert into auth.users(id) values ($1)`, [U])
      await c.query(`insert into public.admin_users(auth_user_id, role, tenant_id) values ($1, 'tenant_admin', $2)`, [U, T])
      const asUser = async () => {
        await c.query('savepoint s')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U, role: 'authenticated' })])
        await c.query('set local role authenticated')
        const n = (await c.query(`select count(*)::int as n from public.admin_users where auth_user_id = $1`, [U])).rows[0].n
        const s = (await c.query(`select public.auth_tenant_suspended() as s`)).rows[0].s
        await c.query('rollback to savepoint s')
        await c.query('reset role')
        return { n, s }
      }
      expect(await asUser()).toEqual({ n: 0, s: true })
      await c.query(`update public.tenants set status = 'active' where id = $1`, [T])
      expect(await asUser()).toEqual({ n: 1, s: false })
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })
})
