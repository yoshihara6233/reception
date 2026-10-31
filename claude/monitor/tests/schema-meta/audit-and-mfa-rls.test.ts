/**
 * 監査の記録と多要素の確認を DB でも守る (20261029120000_audit_and_mfa_rls.sql・自主診断 ASVS 16.4.2・6.3.4)。
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

describe('多要素を登録した利用者は aal2 でなければ DB を使えない (6.3.4)', () => {
  it('許すポリシーを持つ全部の表に mfa_aal2_only (RESTRICTIVE) がある', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and not c.relispartition
          and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                           and p.polname = 'mfa_aal2_only' and not p.polpermissive)
        order by 1`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('登録した人の aal1 は自分の行も読めず、aal2 なら読める。登録していない人は aal1 でも読める', async () => {
    const c = await pool.connect()
    const withMfa = '7f000000-0000-0000-0000-000000000a01'
    const noMfa = '7f000000-0000-0000-0000-000000000a02'
    try {
      await c.query('begin')
      await c.query(`insert into auth.users(id) values ($1), ($2)`, [withMfa, noMfa])
      await c.query(`insert into public.admin_users(auth_user_id, role) values ($1, 'viewer'), ($2, 'viewer')`, [withMfa, noMfa])
      await c.query(
        `insert into auth.mfa_factors(id, user_id, factor_type, status, created_at, updated_at)
         values (gen_random_uuid(), $1, 'totp', 'verified', now(), now())`, [withMfa])
      const count = async (sub: string, aal: string) => {
        await c.query('savepoint s')
        await c.query(`select set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub, role: 'authenticated', aal })])
        await c.query('set local role authenticated')
        const { rows } = await c.query(`select count(*)::int as n from public.admin_users where auth_user_id = $1`, [sub])
        await c.query('rollback to savepoint s')
        await c.query('reset role')
        return rows[0].n as number
      }
      expect(await count(withMfa, 'aal1')).toBe(0)
      expect(await count(withMfa, 'aal2')).toBe(1)
      expect(await count(noMfa, 'aal1')).toBe(1)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })
})

describe('管理者は多要素が必須 (6.3.3)', () => {
  it('未登録の管理者の aal1 は DB を使えず、未登録の閲覧者の aal1 は使える', async () => {
    const c = await pool.connect()
    const ids = { super_admin: '7f000000-0000-0000-0000-000000000b01', tenant_admin: '7f000000-0000-0000-0000-000000000b02', viewer: '7f000000-0000-0000-0000-000000000b03' }
    try {
      await c.query('begin')
      for (const [role, id] of Object.entries(ids)) {
        await c.query(`insert into auth.users(id) values ($1)`, [id])
        await c.query(`insert into public.admin_users(auth_user_id, role) values ($1, $2)`, [id, role])
      }
      const satisfied = async (sub: string, aal: string) => {
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal })])
        return (await c.query(`select public.jwt_mfa_satisfied() as ok`)).rows[0].ok
      }
      expect(await satisfied(ids.super_admin, 'aal1')).toBe(false)
      expect(await satisfied(ids.tenant_admin, 'aal1')).toBe(false)
      expect(await satisfied(ids.tenant_admin, 'aal2')).toBe(true)
      expect(await satisfied(ids.viewer, 'aal1')).toBe(true)
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})

describe('監査の行はサーバだけが書く (16.4.2)', () => {
  it('admin_audit_log に利用者向けの INSERT のポリシーが無い', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      `select p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname = 'admin_audit_log' and p.polpermissive and p.polcmd in ('a', '*')`,
    )
    expect(rows.map((r) => r.polname)).toEqual([])
  })
})
