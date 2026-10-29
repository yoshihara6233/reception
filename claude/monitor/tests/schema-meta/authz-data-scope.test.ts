/**
 * 認可とデータの範囲の残り — **本番と同じ migration を当てた DB** で、利用者のトークン
 * (PostgREST を直接呼んだときと同じ role・クレーム) で実際に書いてみる
 * (20261030120000_authz_data_scope.sql・自主診断 ASVS 2.2.3・8.2.3・8.3.1・8.4.1)。
 *
 * 20261028120000_rls_write_scope.sql で「管理の役割 × 担当の店舗」に絞った後も、
 * 画面と API だけが守っていて DB が知らない規則が残っていた:
 *   - 関連する列の組み合わせ (行の店舗は担当でも、カメラが別の店舗のもの)
 *   - 役割・テナントだけを見る書き込み (計測・ライセンス)
 *   - 店舗の行 (店長が自テナントのどの店舗も・有料オプションも書き換えられた)
 *   - SECURITY DEFINER の関数 (店舗が見えるかを見ない・cron 用の関数が誰でも呼べた)
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

// 種の固定 ID（seed.example.sql・rls-write-scope.test.ts と重ならない値）
const T_A = '7f000000-0000-0000-0000-0000000000a0'
const T_B = '7f000000-0000-0000-0000-0000000000b0'
const S_A1 = '7f000000-0000-0000-0000-0000000001a1'
const S_A2 = '7f000000-0000-0000-0000-0000000001a2'
const S_B1 = '7f000000-0000-0000-0000-0000000001b1'
const E_A1 = '7f000000-0000-0000-0000-0000000002a1'
const E_A2 = '7f000000-0000-0000-0000-0000000002a2'
const R_A1 = '7f000000-0000-0000-0000-0000000003a1'
const R_A2 = '7f000000-0000-0000-0000-0000000003a2'
const C_A1 = '7f000000-0000-0000-0000-0000000004a1'
const C_A2 = '7f000000-0000-0000-0000-0000000004a2'
const EV_A1 = '7f000000-0000-0000-0000-0000000005a1'

const U = {
  super:  '7f000000-0000-0000-0000-000000000901',
  adminA: '7f000000-0000-0000-0000-000000000902',
  adminB: '7f000000-0000-0000-0000-000000000903',
  smgrA1: '7f000000-0000-0000-0000-000000000904',
  viewA1: '7f000000-0000-0000-0000-000000000905',
  /** 管理者の行が無い利用者（役割が NULL になる）。 */
  nobody: '7f000000-0000-0000-0000-000000000906',
} as const
type Who = keyof typeof U

let client: PoolClient
let sp = 0

/** 利用者 `who` として 1 文を流し、変わった（返った）行数か拒否（'denied'）を返す。毎回取り消す。 */
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
  // テナント A は巡回・発報を契約・手荷物検査は未契約。
  await client.query(
    `insert into public.tenants(id, name, plan, status, opt_patrol, opt_alarm, opt_baggage)
     values ($1, 'T-A', 'standard', 'active', true, true, false),
            ($2, 'T-B', 'standard', 'active', true, true, true)`, [T_A, T_B])
  await client.query(
    `insert into public.stores(id, tenant_id, name, opt_patrol, opt_alarm, opt_baggage)
     values ($1, $4, 'A1', false, true, false), ($2, $4, 'A2', false, false, false), ($3, $5, 'B1', false, false, false)`,
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
       ($1, $3, 'edge-a1', 'h7f-a1', 'offline'), ($2, $4, 'edge-a2', 'h7f-a2', 'offline')`,
    [E_A1, E_A2, S_A1, S_A2])
  await client.query(
    `insert into public.recorders(id, edge_id, vendor, host, username, password_enc) values
       ($1, $3, 'nvms', '192.0.2.1', 'u', 'enc:v1:x'), ($2, $4, 'nvms', '192.0.2.2', 'u', 'enc:v1:x')`,
    [R_A1, R_A2, E_A1, E_A2])
  await client.query(
    `insert into public.recorder_cameras(id, recorder_id, channel, name, grid_pos) values
       ($1, $3, 1, 'cam-a1', 0), ($2, $4, 1, 'cam-a2', 0)`, [C_A1, C_A2, R_A1, R_A2])
  await client.query(
    `insert into public.alarm_events(id, store_id, camera_id, source) values ($1, $2, $3, 'test')`,
    [EV_A1, S_A1, C_A1])
  await client.query(
    `insert into public.licenses(edge_id, store_id, tenant_id, license_blob) values ($1, $2, $3, 'blob-7f-a1')`,
    [E_A1, S_A1, T_A])
})

afterAll(async () => {
  await client?.query('rollback').catch(() => {})
  client?.release()
  await pool.end()
})

describe('関連する列の組み合わせ（ASVS 2.2.3）', () => {
  it('担当の店舗の発報でも、別の店舗のカメラは付けられない', async () => {
    expect(await asUser('adminA',
      `insert into public.alarm_events(store_id, camera_id, source) values ('${S_A2}', '${C_A1}', 'test')`,
    )).toBe('denied')
  })

  it('同じ店舗のカメラなら作れる', async () => {
    expect(await asUser('adminA',
      `insert into public.alarm_events(store_id, camera_id, source) values ('${S_A2}', '${C_A2}', 'test')`,
    )).toBe(1)
  })

  it('既存の発報のカメラを別の店舗のものへ書き換えられない', async () => {
    expect(await asUser('adminA',
      `update public.alarm_events set camera_id = '${C_A2}' where id = '${EV_A1}'`,
    )).toBe('denied')
  })

  it('メタ: カメラ・録画機の列を持つ表の書き込みのポリシーは、その列を確かめる', async () => {
    // 行の店舗だけを見て、カメラ・録画機の列を見ない形を拒む。
    // live_sessions は利用者の UPDATE をトリガ（trg_live_sessions_user_guard）で
    // 「終わり」だけに絞っているので対象外。常に偽（作らせない）のポリシーも対象外。
    const { rows } = await client.query<{ relname: string; polname: string }>(
      `select distinct c.relname, p.polname
         from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace ns on ns.oid = c.relnamespace
         join information_schema.columns ic
           on ic.table_schema = 'public' and ic.table_name = c.relname
          and ic.column_name in ('camera_id', 'recorder_id')
        where ns.nspname = 'public'
          and p.polpermissive
          and p.polcmd in ('*', 'a', 'w')
          and c.relname <> 'live_sessions'
          and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') <> 'false'
          and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '')
              !~ format('\\m%s\\M', ic.column_name)
        order by 1, 2`,
    )
    expect(rows.map((r) => `${r.relname}.${r.polname}`)).toEqual([])
  })
})

describe('利用者の接続から作れない（計測・ライセンス）', () => {
  it('閲覧の利用者は別テナントの店舗の計測を作れない', async () => {
    expect(await asUser('viewA1',
      `insert into public.metric_events(kind, store_id) values ('test', '${S_B1}')`,
    )).toBe('denied')
  })

  it('テナントの管理者も計測を作れない（書くのはサーバだけ）', async () => {
    expect(await asUser('adminA',
      `insert into public.metric_events(kind, store_id) values ('test', '${S_A1}')`,
    )).toBe('denied')
  })

  it('別テナントの管理者は、他テナントのエッジのライセンスの行を作れない', async () => {
    expect(await asUser('adminB',
      `insert into public.licenses(edge_id, store_id, tenant_id, license_blob)
       values ('${E_A1}', '${S_A1}', '${T_B}', 'blob-x')`,
    )).toBe('denied')
  })

  it('テナントの管理者もライセンスの行を直接は書けない（API だけが書く）', async () => {
    expect(await asUser('adminA',
      `insert into public.licenses(edge_id, store_id, tenant_id, license_blob)
       values ('${E_A1}', '${S_A1}', '${T_A}', 'blob-y')`,
    )).toBe('denied')
    expect(await asUser('adminA',
      `update public.licenses set status = 'revoked' where edge_id = '${E_A1}'`,
    )).toBe(0)
  })

  it('ライセンスの読み取りはこれまでどおり（自テナント）', async () => {
    expect(await asUser('adminA', `select 1 from public.licenses where edge_id = '${E_A1}'`)).toBe(1)
    expect(await asUser('adminB', `select 1 from public.licenses where edge_id = '${E_A1}'`)).toBe(0)
  })
})

describe('店舗の行（ASVS 8.2.3）', () => {
  it('店長は担当の店舗の名前を変えられる', async () => {
    expect(await asUser('smgrA1', `update public.stores set name = 'A1-x' where id = '${S_A1}'`)).toBe(1)
  })

  it('店長は担当外の店舗（同じテナント）を変えられない', async () => {
    expect(await asUser('smgrA1', `update public.stores set name = 'A2-x' where id = '${S_A2}'`)).toBe(0)
  })

  it('店長は有料オプションを変えられない', async () => {
    expect(await asUser('smgrA1',
      `update public.stores set opt_patrol = true where id = '${S_A1}'`)).toBe('denied')
    expect(await asUser('smgrA1',
      `update public.stores set opt_alarm = false where id = '${S_A1}'`)).toBe('denied')
  })

  it('閲覧の利用者は店舗の行を変えられない', async () => {
    expect(await asUser('viewA1', `update public.stores set name = 'A1-v' where id = '${S_A1}'`)).toBe(0)
  })

  it('テナントの管理者は契約している機能を ON にでき、OFF にもできる', async () => {
    expect(await asUser('adminA',
      `update public.stores set opt_patrol = true where id = '${S_A1}'`)).toBe(1)
    expect(await asUser('adminA',
      `update public.stores set opt_alarm = false where id = '${S_A1}'`)).toBe(1)
  })

  it('テナントの管理者は契約していない機能を ON にできない（作るときも）', async () => {
    expect(await asUser('adminA',
      `update public.stores set opt_baggage = true where id = '${S_A1}'`)).toBe('denied')
    expect(await asUser('adminA',
      `insert into public.stores(tenant_id, name, opt_baggage) values ('${T_A}', 'A-new', true)`)).toBe('denied')
    expect(await asUser('adminA',
      `insert into public.stores(tenant_id, name, opt_patrol) values ('${T_A}', 'A-new', true)`)).toBe(1)
  })

  it('テナントの管理者は店舗を別のテナントへ移せない', async () => {
    expect(await asUser('adminA',
      `update public.stores set tenant_id = '${T_B}' where id = '${S_A1}'`)).toBe('denied')
  })

  it('運営は有料オプションを変えられる', async () => {
    expect(await asUser('super',
      `update public.stores set opt_baggage = true where id = '${S_A1}'`)).toBe(1)
  })
})

describe('start_live_session（ASVS 8.3.1・8.4.1）', () => {
  const start = (store: string, mode = 'live') =>
    `select * from public.start_live_session('${store}', '${mode}')`

  it('別テナントの店舗では視聴の記録を作れない（他テナントの同時視聴の枠を使えない）', async () => {
    expect(await asUser('adminB', start(S_A1))).toBe('denied')
  })

  it('管理者の行が無い利用者は作れない（役割が NULL でも素通りしない）', async () => {
    expect(await asUser('nobody', start(S_A1))).toBe('denied')
  })

  it('同じテナントでも担当外の店舗では作れない', async () => {
    expect(await asUser('smgrA1', start(S_A2))).toBe('denied')
  })

  it('担当の店舗なら作れる（店長・閲覧・テナントの管理者）', async () => {
    expect(await asUser('smgrA1', start(S_A1))).toBe(1)
    expect(await asUser('viewA1', start(S_A1, 'grid'))).toBe(1)
    expect(await asUser('adminA', start(S_A2))).toBe(1)
  })
})

describe('cron とサーバだけが使う関数（ASVS 8.3.1）', () => {
  it.each([
    'public.bcp_sweep_pending_reports()',
    'public.invoke_bcp_report(uuid)',
    'public.invoke_jalert_poller()',
    'public.detect_unmatched_entries(date)',
    'public.usage_summary(date, date, uuid, uuid[])',
    'public.usage_trend(date, date, uuid, uuid[])',
    'public.usage_weekday(date, date, uuid, uuid[])',
  ])('%s は anon・authenticated から呼べず、service_role から呼べる', async (fn) => {
    const { rows } = await client.query<{ anon: boolean; authed: boolean; svc: boolean }>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as authed,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [fn])
    expect(rows[0]).toEqual({ anon: false, authed: false, svc: true })
  })
})
