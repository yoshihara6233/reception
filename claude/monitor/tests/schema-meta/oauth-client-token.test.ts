/**
 * 拠点 (G・VMS) 向けに出したトークンでは、クラウドの DB を使えない
 * (20261029090000_oauth_client_token_scope.sql・自主診断 ASVS 9.2.3・10.3.1)。
 *
 * 1. メタ: RLS を有効にし、許すポリシーを持つ public の全部の表に RESTRICTIVE の first_party_only がある
 *    (新しい表を足したときに付け忘れると落ちる)。
 * 2. 振る舞い: 同じ利用者でも、client_id の付いたトークンでは自分の admin_users の行すら読めない。
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

describe('拠点向けのトークンの範囲', () => {
  it('許すポリシーを持つ全部の表に first_party_only (RESTRICTIVE) がある', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and not c.relispartition
          and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polpermissive)
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                           and p.polname = 'first_party_only' and not p.polpermissive)
        order by 1`,
    )
    expect(rows.map((r) => r.relname),
      '拠点向けのトークンを断るポリシーが無い表です。20261029090000 と同じ形で足してください').toEqual([])
  })

  it('client_id の付いたトークンでは自分の行も読めない・付いていなければ読める', async () => {
    const c = await pool.connect()
    const uid = '7f000000-0000-0000-0000-000000000901'
    try {
      await c.query('begin')
      await c.query(`insert into auth.users(id) values ($1)`, [uid])
      await c.query(`insert into public.admin_users(auth_user_id, role) values ($1, 'viewer')`, [uid])
      const count = async (claims: object) => {
        await c.query('savepoint s')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
        await c.query('set local role authenticated')
        const { rows } = await c.query(`select count(*)::int as n from public.admin_users where auth_user_id = $1`, [uid])
        await c.query('rollback to savepoint s')
        await c.query('reset role')
        return rows[0].n as number
      }
      expect(await count({ sub: uid, role: 'authenticated' })).toBe(1)
      expect(await count({ sub: uid, role: 'authenticated', client_id: 'site-client-1' })).toBe(0)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })
})
