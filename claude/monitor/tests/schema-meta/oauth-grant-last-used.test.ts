/**
 * 拠点 (G・VMS) へのサインインの許可を最後に使った時刻を、セッションから写す
 * (20261030153000_oauth_grant_last_used.sql・発注者の決定 案 B・自主診断 ASVS 10.4.9)。
 * 許可の期限 = max(承認, 最後に使った) + 90 日 (lib/edge/gvms-grants.ts)。
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

const U = '7e500000-0000-0000-0000-000000000901'
const OTHER = '7e500000-0000-0000-0000-000000000902'
const C1 = '7e500000-0000-0000-0000-0000000000c1'
const C2 = '7e500000-0000-0000-0000-0000000000c2'

/** 利用者・拠点のクライアント 2 つ・C1 への許可 (U と OTHER) を作る。C2 には許可が無い。 */
async function seed(c: PoolClient) {
  await c.query(`insert into auth.users(id) values ($1), ($2)`, [U, OTHER])
  await c.query(
    `insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method, client_type)
     values ($1, 'manual', 'https://192.168.0.200:8443/api/v1/auth/oidc/callback', 'authorization_code', 'none', 'public'),
            ($2, 'manual', 'https://192.168.0.201:8443/api/v1/auth/oidc/callback', 'authorization_code', 'none', 'public')`,
    [C1, C2])
  await c.query(
    `insert into auth.oauth_consents(id, user_id, client_id, scopes, granted_at) values
       (gen_random_uuid(), $1, $3, 'openid', now() - interval '200 days'),
       (gen_random_uuid(), $2, $3, 'openid', now() - interval '10 days')`, [U, OTHER, C1])
}

async function lastUsed(c: PoolClient): Promise<Record<string, number>> {
  const { rows } = await c.query<{ user_id: string; client_id: string; ago_h: number }>(
    `select user_id, client_id, round(extract(epoch from (now() - last_used_at)) / 3600)::int as ago_h
       from public.oauth_client_last_used where user_id in ($1, $2) order by 1, 2`, [U, OTHER])
  return Object.fromEntries(rows.map((r) => [`${r.user_id === U ? 'U' : 'OTHER'}:${r.client_id === C1 ? 'C1' : 'C2'}`, r.ago_h]))
}

describe('許可を最後に使った時刻 (10.4.9・案 B)', () => {
  it('purge は 24 時間を過ぎたセッションを消す前に、最後に使った時刻を写す', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      await c.query(
        `insert into auth.sessions(id, user_id, created_at, updated_at, oauth_client_id) values
           (gen_random_uuid(), $1, now() - interval '30 hours', now() - interval '30 hours', $2),
           (gen_random_uuid(), $1, now() - interval '25 hours', now() - interval '25 hours', $2)`, [U, C1])

      const n = (await c.query(`select public.purge_oauth_client_sessions() as n`)).rows[0].n
      expect(n).toBe(2)
      // 消したセッションのうち新しいほう (25 時間前) が残る
      expect(await lastUsed(c)).toEqual({ 'U:C1': 25 })
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('時刻は前へだけ進む。更新の時刻も使った印にする', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      await c.query(`insert into public.oauth_client_last_used(user_id, client_id, last_used_at)
                     values ($1, $2, now() - interval '5 hours')`, [U, C1])
      // 古いセッションでは戻らない
      await c.query(`insert into auth.sessions(id, user_id, created_at, updated_at, oauth_client_id)
                     values (gen_random_uuid(), $1, now() - interval '20 hours', now() - interval '20 hours', $2)`, [U, C1])
      await c.query(`select public.record_oauth_client_use()`)
      expect(await lastUsed(c)).toEqual({ 'U:C1': 5 })
      // 作ってから更新したセッションは、更新の時刻で進む
      await c.query(`insert into auth.sessions(id, user_id, created_at, updated_at, oauth_client_id)
                     values (gen_random_uuid(), $1, now() - interval '20 hours', now() - interval '1 hour', $2)`, [U, C1])
      await c.query(`select public.record_oauth_client_use()`)
      expect(await lastUsed(c)).toEqual({ 'U:C1': 1 })
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('許可の無い組 (取り消した・切れた) の行は残さない。クラウドのログインは写さない', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      await c.query(
        `insert into auth.sessions(id, user_id, created_at, oauth_client_id) values
           (gen_random_uuid(), $1, now() - interval '1 hour', $2),
           (gen_random_uuid(), $1, now() - interval '1 hour', $3),
           (gen_random_uuid(), $1, now() - interval '1 hour', null)`, [U, C1, C2])
      await c.query(`select public.record_oauth_client_use()`)
      expect(await lastUsed(c)).toEqual({ 'U:C1': 1 })

      await c.query(`update auth.oauth_consents set revoked_at = now() where user_id = $1 and client_id = $2`, [U, C1])
      await c.query(`select public.record_oauth_client_use()`)
      expect(await lastUsed(c)).toEqual({})
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('本人は自分の行だけを読める。書けない。関数は呼べない', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      await c.query(`insert into public.oauth_client_last_used(user_id, client_id, last_used_at)
                     values ($1, $3, now()), ($2, $3, now())`, [U, OTHER, C1])
      await c.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: U, role: 'authenticated', aal: 'aal1' })])
      await c.query('set local role authenticated')
      const mine = (await c.query(`select user_id from public.oauth_client_last_used`)).rows.map((r) => r.user_id)
      expect(mine).toEqual([U])

      await c.query('savepoint w')
      await expect(c.query(`insert into public.oauth_client_last_used(user_id, client_id, last_used_at)
                            values ($1, $2, now())`, [U, C1])).rejects.toThrow(/permission denied/)
      await c.query('rollback to savepoint w')
      await expect(c.query(`update public.oauth_client_last_used set last_used_at = now()`))
        .rejects.toThrow(/permission denied/)
      await c.query('rollback to savepoint w')
      await expect(c.query(`select public.record_oauth_client_use()`)).rejects.toThrow(/permission denied/)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('拠点向けのトークン (client_id の付いたもの) では自分の行も読めない', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await seed(c)
      await c.query(`insert into public.oauth_client_last_used(user_id, client_id, last_used_at) values ($1, $2, now())`, [U, C1])
      await c.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: U, role: 'authenticated', client_id: C1 })])
      await c.query('set local role authenticated')
      expect((await c.query(`select count(*)::int as n from public.oauth_client_last_used`)).rows[0].n).toBe(0)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })
})
