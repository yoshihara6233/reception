/**
 * authz 契約テスト（Phase A / G1・不可侵）。
 *
 * テナント×ロールの越権（クロステナント漏洩）が起きないことを実DB(Postgres+RLS)で
 * 実証する。各クエリを authenticated ロール + JWTクレーム(auth.uid)で実行し、RLSの
 * 可視範囲を検証する。スキーマ/ポリシーは tests/authz/schema.sql（実ポリシー転記）。
 *
 * 実行: DATABASE_URL を指定して `bun run test:authz`（CIは postgres サービス使用）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres' })

// 固定UUID（読みやすさ優先）
const T_A = '0a000000-0000-0000-0000-0000000000a0'
const T_B = '0b000000-0000-0000-0000-0000000000b0'
const S_A1 = 'a1000000-0000-0000-0000-0000000000a1'
const S_A2 = 'a2000000-0000-0000-0000-0000000000a2'
const S_B1 = 'b1000000-0000-0000-0000-0000000000b1'
const E_A1 = 'e1000000-0000-0000-0000-0000000000a1'
const E_A2 = 'e2000000-0000-0000-0000-0000000000a2'
const E_B1 = 'eb000000-0000-0000-0000-0000000000b1'
const REC_B1 = 'cb000000-0000-0000-0000-0000000000b1'
const CAM_B1 = 'fb000000-0000-0000-0000-0000000000b1'
// personas (auth.users.id = admin_users.auth_user_id)
const U_SUPER  = '00000000-0000-0000-0000-000000000099'
const U_TADMINA = '00000000-0000-0000-0000-0000000000a0'
const U_TADMINB = '00000000-0000-0000-0000-0000000000b0'
const U_SMGRA1  = '00000000-0000-0000-0000-0000000000c1'

/** authenticated ロール + 指定ユーザの JWT で SELECT を実行（RLS適用・read-only）。 */
async function asUser(sub: string | null, sql: string): Promise<Record<string, unknown>[]> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query(`set local request.jwt.claims = '${JSON.stringify(sub ? { sub } : {})}'`)
    const res = await client.query(sql)
    return res.rows
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id as string).sort()

beforeAll(async () => {
  // スキーマ適用（毎回クリーン）。cwd は claude/monitor（test:authz 実行ディレクトリ）。
  const schema = readFileSync(join(process.cwd(), 'tests/authz/schema.sql'), 'utf8')
  await pool.query(schema)

  // シード（postgres=superuser で RLS バイパス）
  await pool.query(`
    insert into auth.users (id) values ('${U_SUPER}'),('${U_TADMINA}'),('${U_TADMINB}'),('${U_SMGRA1}');
    insert into public.tenants (id, name) values ('${T_A}','A'),('${T_B}','B');
    insert into public.stores (id, tenant_id, name) values
      ('${S_A1}','${T_A}','A1'),('${S_A2}','${T_A}','A2'),('${S_B1}','${T_B}','B1');
    insert into public.admin_users (auth_user_id, role, tenant_id, store_ids) values
      ('${U_SUPER}','super_admin', null, '{}'),
      ('${U_TADMINA}','tenant_admin','${T_A}','{}'),
      ('${U_TADMINB}','tenant_admin','${T_B}','{}'),
      ('${U_SMGRA1}','store_manager','${T_A}','{${S_A1}}');
    insert into public.edge_devices (id, store_id, name) values
      ('${E_A1}','${S_A1}','edgeA1'),('${E_A2}','${S_A2}','edgeA2'),('${E_B1}','${S_B1}','edgeB1');
    insert into public.recorders (id, edge_id, vendor, host) values ('${REC_B1}','${E_B1}','onvif-generic','10.0.0.1');
    insert into public.recorder_cameras (id, recorder_id, channel, name) values ('${CAM_B1}','${REC_B1}',1,'camB1');
    insert into public.live_sessions (user_id, store_id, mode) values ('${U_SMGRA1}','${S_A1}','live');
    insert into public.session_limits (tenant_id) values ('${T_A}'),('${T_B}');
    insert into public.enrollment_tokens (token_hash, store_id, tenant_id, name, expires_at)
      values ('hash_a1', '${S_A1}', '${T_A}', 'pendingA1', now() + interval '1 day');
  `)
})

afterAll(async () => { await pool.end() })

describe('edge_devices RLS（テナント×ロール越権防止）', () => {
  it('super_admin は全エッジを見える', async () => {
    expect(ids(await asUser(U_SUPER, 'select id from edge_devices'))).toEqual([E_A1, E_A2, E_B1].sort())
  })
  it('tenant_admin A は自テナントのエッジのみ（B は不可視）', async () => {
    expect(ids(await asUser(U_TADMINA, 'select id from edge_devices'))).toEqual([E_A1, E_A2].sort())
  })
  it('tenant_admin B は自テナントのエッジのみ（A は不可視）', async () => {
    expect(ids(await asUser(U_TADMINB, 'select id from edge_devices'))).toEqual([E_B1])
  })
  it('store_manager A1 は担当店舗のエッジのみ', async () => {
    expect(ids(await asUser(U_SMGRA1, 'select id from edge_devices'))).toEqual([E_A1])
  })
  it('未認証(anon)は何も見えない', async () => {
    expect(await asUser(null, 'select id from edge_devices')).toHaveLength(0)
  })
})

describe('recorders / recorder_cameras は edge 可視性に連鎖', () => {
  it('tenant_admin A は B テナントのレコーダ/カメラを見られない', async () => {
    expect(await asUser(U_TADMINA, 'select id from recorders')).toHaveLength(0)
    expect(await asUser(U_TADMINA, 'select id from recorder_cameras')).toHaveLength(0)
  })
  it('tenant_admin B / super_admin は B のレコーダ/カメラを見える', async () => {
    expect(ids(await asUser(U_TADMINB, 'select id from recorders'))).toEqual([REC_B1])
    expect(ids(await asUser(U_SUPER, 'select id from recorder_cameras'))).toEqual([CAM_B1])
  })
})

describe('live_sessions RLS（自分 or tenant_admin/super_admin）', () => {
  it('セッション本人(store_manager)は自分のセッションを見える', async () => {
    expect(await asUser(U_SMGRA1, 'select id from live_sessions')).toHaveLength(1)
  })
  it('同テナントの tenant_admin はテナント内セッションを見える', async () => {
    expect(await asUser(U_TADMINA, 'select id from live_sessions')).toHaveLength(1)
  })
  it('別テナントの tenant_admin はセッションを見られない（20260621_003でスコープ）', async () => {
    expect(await asUser(U_TADMINB, 'select id from live_sessions')).toHaveLength(0)
  })
})

describe('enrollment_tokens は RLS で全拒否（service_role のみアクセス可）', () => {
  it('super_admin / tenant_admin / store_manager / anon いずれも読めない', async () => {
    for (const u of [U_SUPER, U_TADMINA, U_SMGRA1, null]) {
      expect(await asUser(u, 'select id from enrollment_tokens')).toHaveLength(0)
    }
  })
})

describe('session_limits RLS', () => {
  it('tenant_admin A は自テナントの limit のみ', async () => {
    expect(ids(await asUser(U_TADMINA, 'select tenant_id as id from session_limits'))).toEqual([T_A])
  })
  it('super_admin は全 limit', async () => {
    expect(ids(await asUser(U_SUPER, 'select tenant_id as id from session_limits'))).toEqual([T_A, T_B].sort())
  })
})
