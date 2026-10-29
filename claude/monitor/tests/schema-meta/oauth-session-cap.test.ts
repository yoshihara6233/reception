/**
 * 拠点 (G・VMS) 向けのセッションと refresh トークンは 24 時間で消える
 * (20261030093100_oauth_client_session_cap.sql・自主診断 ASVS 10.4.8)。
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

const U = '7e400000-0000-0000-0000-000000000901'
const C = '7e400000-0000-0000-0000-0000000000c1'
const OLD = '7e400000-0000-0000-0000-00000000a001'
const FRESH = '7e400000-0000-0000-0000-00000000a002'
const FIRST_PARTY = '7e400000-0000-0000-0000-00000000a003'

describe('拠点向けのセッションの期限 (10.4.8)', () => {
  it('24 時間を過ぎた拠点向けのセッションと refresh トークンを消す。クラウドのログインには触れない', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(`insert into auth.users(id) values ($1)`, [U])
      await c.query(
        `insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method, client_type)
         values ($1, 'manual', 'https://192.168.0.200:8443/api/v1/auth/oidc/callback', 'authorization_code', 'none', 'public')`, [C])
      await c.query(
        `insert into auth.sessions(id, user_id, created_at, oauth_client_id) values
           ($1, $4, now() - interval '25 hours', $5),
           ($2, $4, now() - interval '1 hour',   $5),
           ($3, $4, now() - interval '30 days',  null)`, [OLD, FRESH, FIRST_PARTY, U, C])
      await c.query(`insert into auth.refresh_tokens(token, user_id, session_id, revoked) values ('t-7e4', $1, $2, false)`, [U, OLD])

      // 上限より長い期限を渡しても 24 時間で消す (呼び出しの誤りで延ばせない)
      const n = (await c.query(`select public.purge_oauth_client_sessions(interval '100 days') as n`)).rows[0].n
      expect(n).toBe(1)
      const left = (await c.query(`select id from auth.sessions where user_id = $1 order by id`, [U])).rows.map((r) => r.id)
      expect(left).toEqual([FRESH, FIRST_PARTY])
      expect((await c.query(`select count(*)::int as n from auth.refresh_tokens where token = 't-7e4'`)).rows[0].n).toBe(0)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('利用者 (authenticated) は呼べない', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role authenticated')
      await expect(c.query('select public.purge_oauth_client_sessions()')).rejects.toThrow(/permission denied/)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  })

  it('cron に 15 分ごとで登録されている', async () => {
    const { rows } = await pool.query(
      `select schedule from cron.job where jobname = 'oauth_client_session_purge' and active`)
    expect(rows.map((r) => r.schedule)).toEqual(['*/15 * * * *'])
  })
})
