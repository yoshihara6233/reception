import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

/**
 * エッジ端末トークンのハッシュ保管（脆弱性検査 M-5）。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① **DB とアプリのハッシュが同じ値になる**。ここがずれると全エッジが同時に
 *    認証できなくなる。今日 B4 で service_role を消したので、bootstrap が
 *    落ちるとエッジには代替経路が無い（スコープトークンの期限 1 時間で停止）。
 * ② 一意索引が効いている（別エッジが同じハッシュを持てない）。
 * ③ NOT NULL が効いている（ハッシュ無しの行を作れない＝移行の取りこぼしが残らない）。
 *
 * ── なぜ SHA-256 で足りるか ──────────────────────────────────────────────
 * device_token は `randomBytes(32).toString('hex')` の 32 バイト乱数。
 * 総当たりも辞書も成立しないので鍵伸長は不要。キオスク PIN が scrypt なのは
 * 4〜6 桁の人間由来だからで、根拠が違う。隣の `enrollment_tokens.token_hash`
 * も同じ理由で SHA-256（方式を揃えている）。
 *
 * ── 実際に踏んだ間違い ──────────────────────────────────────────────────
 * 最初この migration を空のローカル DB に当てて「backfill 一致 0/0」を見て
 * 通ったと判断しかけた。**0 行に対する検算は何の証拠にもならない。**
 * 行を入れてから測り直している。
 */

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

const TENANT = '0a000000-0000-0000-0000-0000000005a0'
const STORE  = 'a1000000-0000-0000-0000-0000000005a1'

/** アプリ側と同じ計算（src/lib/edge/device-token.ts と一致させる）。 */
const appHash = (raw: string) => createHash('sha256').update(raw).digest('hex')

beforeAll(async () => {
  await pool.query(
    `insert into public.tenants (id, name, plan) values ($1,'M5テスト','starter')
     on conflict (id) do nothing`, [TENANT])
  await pool.query(
    `insert into public.stores (id, tenant_id, name) values ($1,$2,'M5店')
     on conflict (id) do nothing`, [STORE, TENANT])
})

afterEach(async () => {
  await pool.query('delete from public.edge_devices where store_id = $1', [STORE])
})

afterAll(async () => {
  await pool.query('delete from public.stores  where id = $1', [STORE])
  await pool.query('delete from public.tenants where id = $1', [TENANT])
  await pool.end()
})

async function addEdge(name: string, token: string): Promise<void> {
  await pool.query(
    `insert into public.edge_devices (store_id, name, device_token, device_token_hash)
     values ($1, $2, $3, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'))`, [STORE, name, token])
}

describe('edge_devices.device_token_hash', () => {
  it('★DB の sha256 とアプリの createHash が同じ値になる', async () => {
    // ここがずれると全エッジが同時に認証できなくなる。
    const token = 'a'.repeat(64)
    await addEdge('m5-a', token)
    const { rows } = await pool.query(
      'select device_token_hash from public.edge_devices where name = $1', ['m5-a'])
    expect(rows[0].device_token_hash).toBe(appHash(token))
  })

  it('★アプリ側のハッシュで引き当てられる（認証経路そのもの）', async () => {
    const token = 'deadbeef'.repeat(8)
    await addEdge('m5-b', token)
    const { rows } = await pool.query(
      'select name from public.edge_devices where device_token_hash = $1', [appHash(token)])
    expect(rows.map((r) => r.name)).toEqual(['m5-b'])
  })

  it('別のトークンでは引き当たらない', async () => {
    await addEdge('m5-c', 'token-c')
    const { rows } = await pool.query(
      'select name from public.edge_devices where device_token_hash = $1', [appHash('token-x')])
    expect(rows).toHaveLength(0)
  })

  it('同じハッシュを 2 台が持てない（一意索引）', async () => {
    await addEdge('m5-d', 'same-token')
    await expect(addEdge('m5-e', 'same-token')).rejects.toThrow(/duplicate key|unique/i)
  })

  it('ハッシュ無しの行は作れない（NOT NULL）', async () => {
    await expect(
      pool.query(
        `insert into public.edge_devices (store_id, name, device_token)
         values ($1,'m5-f','no-hash')`, [STORE]),
    ).rejects.toThrow(/null value|not-null/i)
  })
})
