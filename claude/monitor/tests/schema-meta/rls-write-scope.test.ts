/**
 * 書き込みの担当範囲の検査 — **本番と同じ migration を当てた DB** で、役割ごとに
 * 実際に書いてみる（20261028120000_rls_write_scope.sql）。
 *
 * 2026-10-28 の自主診断（ASVS 8.2.1・8.2.2・15.3.3）で 2 種類の抜けが見つかった:
 *   - 役割だけを見る FOR ALL のポリシー … 別テナントの管理者が他テナントの行を読み書きできた
 *   - 見えるかだけを見るポリシー（機器・録画機・カメラ） … 閲覧の利用者が書き換えられた
 * 画面と API は役割で止めていたが、PostgREST を直接呼ぶと DB のポリシーだけが守りになる。
 *
 * 種は 1 つのトランザクションの中で作り、最後に必ず取り消す（DB を汚さない）。
 * 1 件ずつ SAVEPOINT で区切るので、拒否（例外）が出ても後の検査は続く。
 *
 * 実行: bunx supabase start && bunx supabase db reset && bun run test:schema-meta
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

// 種の固定 ID（seed.example.sql と重ならない値）
const T_A = '7e000000-0000-0000-0000-0000000000a0'
const T_B = '7e000000-0000-0000-0000-0000000000b0'
const S_A1 = '7e000000-0000-0000-0000-0000000001a1'
const S_A2 = '7e000000-0000-0000-0000-0000000001a2'
const S_B1 = '7e000000-0000-0000-0000-0000000001b1'
const E_A1 = '7e000000-0000-0000-0000-0000000002a1'
const E_B1 = '7e000000-0000-0000-0000-0000000002b1'
const R_A1 = '7e000000-0000-0000-0000-0000000003a1'
const C_A1 = '7e000000-0000-0000-0000-0000000004a1'

const U = {
  super:  '7e000000-0000-0000-0000-000000000901',
  adminA: '7e000000-0000-0000-0000-000000000902',
  adminB: '7e000000-0000-0000-0000-000000000903',
  smgrA1: '7e000000-0000-0000-0000-000000000904',
  viewA1: '7e000000-0000-0000-0000-000000000905',
} as const
type Who = keyof typeof U

let client: PoolClient
let sp = 0

/** 利用者 `who` として 1 文を流し、変わった行数か拒否（'denied'）を返す。毎回取り消す。 */
async function asUser(who: Who, sql: string): Promise<number | 'denied'> {
  const name = `sp${++sp}`
  await client.query(`savepoint ${name}`)
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: U[who], role: 'authenticated' })])
    await client.query('set local role authenticated')
    const res = await client.query(sql)
    return res.rowCount ?? 0
  } catch (e) {
    if ((e as { code?: string }).code === '42501') return 'denied'
    throw e
  } finally {
    await client.query(`rollback to savepoint ${name}`)
    await client.query('reset role')
  }
}

beforeAll(async () => {
  client = await pool.connect()
  await client.query('begin')
  await client.query(`insert into public.tenants(id, name, plan) values ($1, 'T-A', 'standard'), ($2, 'T-B', 'standard')`, [T_A, T_B])
  await client.query(
    `insert into public.stores(id, tenant_id, name) values ($1, $4, 'A1'), ($2, $4, 'A2'), ($3, $5, 'B1')`,
    [S_A1, S_A2, S_B1, T_A, T_B])
  for (const id of Object.values(U)) {
    await client.query(`insert into auth.users(id) values ($1)`, [id])
  }
  await client.query(
    `insert into public.admin_users(auth_user_id, role, tenant_id, store_ids) values
       ($1, 'super_admin',   null, '{}'),
       ($2, 'tenant_admin',  $6,   '{}'),
       ($3, 'tenant_admin',  $7,   '{}'),
       ($4, 'store_manager', $6,   array[$8]::uuid[]),
       ($5, 'viewer',        $6,   array[$8]::uuid[])`,
    [U.super, U.adminA, U.adminB, U.smgrA1, U.viewA1, T_A, T_B, S_A1])
  await client.query(
    `insert into public.edge_devices(id, store_id, name, device_token_hash, status) values
       ($1, $3, 'edge-a1', 'h-a1', 'offline'), ($2, $4, 'edge-b1', 'h-b1', 'offline')`,
    [E_A1, E_B1, S_A1, S_B1])
  await client.query(
    `insert into public.recorders(id, edge_id, vendor, host, username, password_enc)
     values ($1, $2, 'nvms', '192.0.2.1', 'u', 'enc:v1:x')`, [R_A1, E_A1])
  await client.query(
    `insert into public.recorder_cameras(id, recorder_id, channel, name, grid_pos)
     values ($1, $2, 1, 'cam-1', 0)`, [C_A1, R_A1])
  await client.query(`insert into public.alarm_settings(store_id) values ($1), ($2)`, [S_A1, S_B1])
})

afterAll(async () => {
  await client?.query('rollback').catch(() => {})
  client?.release()
  await pool.end()
})

describe('機器（edge_devices）を書けるのは運営だけ', () => {
  it.each<[Who, number | 'denied']>([
    ['viewA1', 0], ['smgrA1', 0], ['adminA', 0], ['super', 1],
  ])('%s の UPDATE', async (who, want) => {
    expect(await asUser(who, `update public.edge_devices set scoped_only = not scoped_only where id = '${E_A1}'`)).toBe(want)
  })

  it('閲覧の利用者は機器を作れない', async () => {
    expect(await asUser('viewA1',
      `insert into public.edge_devices(store_id, name, device_token_hash, status) values ('${S_A1}', 'x', 'h-x', 'offline')`,
    )).toBe('denied')
  })

  it('運営でも機器の認証の列は利用者の接続から変えられない', async () => {
    expect(await asUser('super', `update public.edge_devices set device_token_hash = 'h-new' where id = '${E_A1}'`)).toBe('denied')
  })
})

describe('録画機・カメラを書けるのは担当の管理者だけ', () => {
  it.each<[Who, number]>([
    ['viewA1', 0], ['adminB', 0], ['smgrA1', 1], ['adminA', 1], ['super', 1],
  ])('%s の録画機の UPDATE', async (who, want) => {
    expect(await asUser(who, `update public.recorders set host = host where id = '${R_A1}'`)).toBe(want)
  })

  it.each<[Who, number]>([
    ['viewA1', 0], ['adminB', 0], ['smgrA1', 1],
  ])('%s のカメラの UPDATE', async (who, want) => {
    expect(await asUser(who, `update public.recorder_cameras set name = name where id = '${C_A1}'`)).toBe(want)
  })
})

describe('別テナントの行は読めず書けない（発報の設定）', () => {
  it('テナント B の管理者はテナント A の設定を読めない', async () => {
    expect(await asUser('adminB', `select 1 from public.alarm_settings where store_id = '${S_A1}'`)).toBe(0)
  })

  it('テナント B の管理者はテナント A の設定を書けない', async () => {
    expect(await asUser('adminB', `update public.alarm_settings set store_id = store_id where store_id = '${S_A1}'`)).toBe(0)
  })

  it('A1 の店長は自店舗だけを書ける', async () => {
    expect(await asUser('smgrA1', `update public.alarm_settings set store_id = store_id`)).toBe(1)
  })

  it('閲覧の利用者は自店舗でも書けない', async () => {
    expect(await asUser('viewA1', `update public.alarm_settings set store_id = store_id`)).toBe(0)
  })
})

describe('メタ: 書き込みのポリシーが役割だけを見ていない', () => {
  it('admin_users の役割を見る書き込みのポリシーは、店舗かテナントも見る', async () => {
    // FOR ALL / INSERT / UPDATE / DELETE で `u.role` だけを条件にする形を拒む
    // （本人の行だけを見るもの・役割を見ないものは対象外）。
    // 運営専用（super_admin だけ）の表は店舗を持たないので対象外。
    const { rows } = await client.query<{ relname: string; polname: string }>(
      `select c.relname, p.polname
         from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public'
          and p.polcmd in ('*', 'a', 'w', 'd')
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
              ~ 'u\\.role'
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
              !~ '(store_id|tenant_id|store_ids)'
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
              !~ $$u\\.role = 'super_admin'::text\\)\\)\\)\\)$$
        order by 1, 2`,
    )
    expect(rows.map((r) => `${r.relname}.${r.polname}`)).toEqual([])
  })
})
