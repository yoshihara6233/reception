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
const REC_A1 = 'ca000000-0000-0000-0000-0000000000a1'
const CAM_A1 = 'fa000000-0000-0000-0000-0000000000a1'
const REC_B1 = 'cb000000-0000-0000-0000-0000000000b1'
const CAM_B1 = 'fb000000-0000-0000-0000-0000000000b1'
// Phase B2: エッジが書く証跡系（A1店舗 と B1店舗 の対で越権を見る）
const SES_A1 = '2a000000-0000-0000-0000-0000000000a1'
const SES_B1 = '2b000000-0000-0000-0000-0000000000b1'
const CJ_A1  = '3a000000-0000-0000-0000-0000000000a1'
const CJ_B1  = '3b000000-0000-0000-0000-0000000000b1'
const CL_A1  = '4a000000-0000-0000-0000-0000000000a1'
const CL_B1  = '4b000000-0000-0000-0000-0000000000b1'
const VC_A1  = '5a000000-0000-0000-0000-0000000000a1'
const VC_B1  = '5b000000-0000-0000-0000-0000000000b1'
const BE_A1  = '6a000000-0000-0000-0000-0000000000a1'
const BE_B1  = '6b000000-0000-0000-0000-0000000000b1'
const BC_A1  = '6a000000-0000-0000-0000-0000000000c1'
const BC_B1  = '6b000000-0000-0000-0000-0000000000c1'
// edge_jobs（Phase B1）: 各エッジ宛ジョブ
const J_A1 = '1a000000-0000-0000-0000-0000000000a1'
const J_A2 = '1a000000-0000-0000-0000-0000000000a2'
const J_B1 = '1b000000-0000-0000-0000-0000000000b1'
// jalert_receipts（全国受信ログ・店舗非依存）
const JR_1 = '7a000000-0000-0000-0000-0000000000a1'
// edge_command_runs（命令の受領記録）: 受領済み・未決着の行を各エッジに1件
const R_A1 = '9a000000-0000-0000-0000-0000000000a1'
const R_B1 = '9b000000-0000-0000-0000-0000000000b1'
// personas (auth.users.id = admin_users.auth_user_id)
const U_SUPER  = '00000000-0000-0000-0000-000000000099'
const U_TADMINA = '00000000-0000-0000-0000-0000000000a0'
const U_TADMINB = '00000000-0000-0000-0000-0000000000b0'
const U_SMGRA1  = '00000000-0000-0000-0000-0000000000c1'
// 店舗限定ロールの残り2つ。テナントAの別々の店舗に割り当て、同テナント内でも
// 担当外店舗が見えないことを見る（viewer=A1 / baggage_manager=A2）。
const U_VIEWA1  = '00000000-0000-0000-0000-0000000000d1'
const U_BMGRA2  = '00000000-0000-0000-0000-0000000000e2'

/** 店舗限定ロール（acting.ts の STORE_SCOPED_ROLES と同じ集合）。 */
const STORE_SCOPED = [
  { name: 'store_manager',   user: U_SMGRA1, store: S_A1, edge: E_A1 },
  { name: 'viewer',          user: U_VIEWA1, store: S_A1, edge: E_A1 },
  { name: 'baggage_manager', user: U_BMGRA2, store: S_A2, edge: E_A2 },
] as const

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

const ids = (rows: Record<string, unknown>[], key = 'id') =>
  rows.map((r) => r[key] as string).sort()

beforeAll(async () => {
  // スキーマ適用（毎回クリーン）。cwd は claude/monitor（test:authz 実行ディレクトリ）。
  const schema = readFileSync(join(process.cwd(), 'tests/authz/schema.sql'), 'utf8')
  await pool.query(schema)

  // シード（postgres=superuser で RLS バイパス）
  await pool.query(`
    insert into auth.users (id) values
      ('${U_SUPER}'),('${U_TADMINA}'),('${U_TADMINB}'),('${U_SMGRA1}'),('${U_VIEWA1}'),('${U_BMGRA2}');
    insert into public.tenants (id, name) values ('${T_A}','A'),('${T_B}','B');
    insert into public.stores (id, tenant_id, name) values
      ('${S_A1}','${T_A}','A1'),('${S_A2}','${T_A}','A2'),('${S_B1}','${T_B}','B1');
    insert into public.admin_users (auth_user_id, role, tenant_id, store_ids) values
      ('${U_SUPER}','super_admin', null, '{}'),
      ('${U_TADMINA}','tenant_admin','${T_A}','{}'),
      ('${U_TADMINB}','tenant_admin','${T_B}','{}'),
      ('${U_SMGRA1}','store_manager','${T_A}','{${S_A1}}'),
      ('${U_VIEWA1}','viewer','${T_A}','{${S_A1}}'),
      ('${U_BMGRA2}','baggage_manager','${T_A}','{${S_A2}}');
    insert into public.edge_devices (id, store_id, name, scoped_only) values
      ('${E_A1}','${S_A1}','edgeA1', true),   -- B4 適用済みのエッジ（鍵を配らない宣言）
      ('${E_A2}','${S_A2}','edgeA2', false),('${E_B1}','${S_B1}','edgeB1', false);
    insert into public.recorders (id, edge_id, vendor, host) values
      ('${REC_A1}','${E_A1}','onvif-generic','10.0.0.2'),
      ('${REC_B1}','${E_B1}','onvif-generic','10.0.0.1');
    insert into public.recorder_cameras (id, recorder_id, channel, name) values
      ('${CAM_A1}','${REC_A1}',1,'camA1'),
      ('${CAM_B1}','${REC_B1}',1,'camB1');
    insert into public.live_sessions (user_id, store_id, mode) values ('${U_SMGRA1}','${S_A1}','live');
    insert into public.session_limits (tenant_id) values ('${T_A}'),('${T_B}');
    insert into public.enrollment_tokens (token_hash, store_id, tenant_id, name, expires_at)
      values ('hash_a1', '${S_A1}', '${T_A}', 'pendingA1', now() + interval '1 day');
    insert into public.edge_jobs (id, edge_id) values
      ('${J_A1}','${E_A1}'),('${J_A2}','${E_A2}'),('${J_B1}','${E_B1}');
    -- 受領済み・未決着の命令記録（決着＝update が通るかを見るため）
    insert into public.edge_command_runs (request_id, edge_id, action) values
      ('${R_A1}','${E_A1}','start_grid'),('${R_B1}','${E_B1}','start_grid');
    insert into public.jalert_receipts (id, alert_source, alert_type, title) values
      ('${JR_1}','jma-entry-1','earthquake','震源・震度に関する情報');
    -- Phase B2: 店舗A1(テナントA) と 店舗B1(テナントB) に同じ形の証跡を置く
    insert into public.inspection_sessions (id, tenant_id, store_id) values
      ('${SES_A1}','${T_A}','${S_A1}'),('${SES_B1}','${T_B}','${S_B1}');
    insert into public.inspection_clip_jobs (id, tenant_id, store_id, session_id, camera_id) values
      ('${CJ_A1}','${T_A}','${S_A1}','${SES_A1}','${CAM_A1}'),
      ('${CJ_B1}','${T_B}','${S_B1}','${SES_B1}','${CAM_B1}');
    insert into public.inspection_clips (id, tenant_id, store_id, session_id, camera_id, storage_path) values
      ('${CL_A1}','${T_A}','${S_A1}','${SES_A1}','${CAM_A1}','a1.mp4'),
      ('${CL_B1}','${T_B}','${S_B1}','${SES_B1}','${CAM_B1}','b1.mp4');
    insert into public.vod_clips (id, camera_id) values ('${VC_A1}','${CAM_A1}'),('${VC_B1}','${CAM_B1}');
    insert into public.bcp_events (id, store_id) values ('${BE_A1}','${S_A1}'),('${BE_B1}','${S_B1}');
    insert into public.bcp_clips (id, event_id, camera_id) values
      ('${BC_A1}','${BE_A1}','${CAM_A1}'),('${BC_B1}','${BE_B1}','${CAM_B1}');
  `)
})

/** authenticated ロール + エッジ scoped クレーム(app_metadata.edge_id)で実行（RLS適用）。 */
async function asEdge(edgeId: string | null, sql: string): Promise<Record<string, unknown>[]> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    const claims = edgeId
      ? { sub: '00000000-0000-0000-0000-0000000000ee', app_metadata: { edge_id: edgeId, role: 'edge' } }
      : {}
    await client.query(`set local request.jwt.claims = '${JSON.stringify(claims)}'`)
    const res = await client.query(sql)
    return res.rows
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

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

describe('stores RLS（店舗×ロール可視性: super=全件 / tenant_admin=自テナント / store_manager=担当店舗）', () => {
  it('super_admin は全店舗', async () => {
    expect(ids(await asUser(U_SUPER, 'select id from stores'))).toEqual([S_A1, S_A2, S_B1].sort())
  })
  it('tenant_admin A は自テナントの店舗のみ（B は不可視）', async () => {
    expect(ids(await asUser(U_TADMINA, 'select id from stores'))).toEqual([S_A1, S_A2].sort())
  })
  it('store_manager A1 は担当店舗のみ（同テナントの A2 も不可視）', async () => {
    expect(ids(await asUser(U_SMGRA1, 'select id from stores'))).toEqual([S_A1])
  })
  it('未認証(anon)は何も見えない', async () => {
    expect(await asUser(null, 'select id from stores')).toHaveLength(0)
  })
})

describe('店舗限定ロール3種（store_manager / viewer / baggage_manager）の等価性', () => {
  // stores_select の store_ids 節は 20260723150000 以降**ロール非依存**。
  // ここを `role = 'store_manager'` に限定すると viewer / baggage_manager が
  // 自店舗すら見えなくなる（本番とのドリフト）。3ロール横並びで固定する。
  it.each(STORE_SCOPED)('$name は担当店舗のみ見える（同テナントの担当外店舗は不可視）', async ({ user, store }) => {
    expect(ids(await asUser(user, 'select id from stores'))).toEqual([store])
  })

  it.each(STORE_SCOPED)('$name は担当店舗のエッジのみ見える', async ({ user, edge }) => {
    expect(ids(await asUser(user, 'select id from edge_devices'))).toEqual([edge])
  })

  it.each(STORE_SCOPED)('$name は他テナント(B)の店舗・エッジを一切見られない', async ({ user }) => {
    expect(await asUser(user, `select id from stores where id='${S_B1}'`)).toHaveLength(0)
    expect(await asUser(user, `select id from edge_devices where id='${E_B1}'`)).toHaveLength(0)
  })

  it.each(STORE_SCOPED)('$name は enrollment_tokens を読めない（トークン漏洩面を作らない）', async ({ user }) => {
    expect(await asUser(user, 'select id from enrollment_tokens')).toHaveLength(0)
  })

  it.each(STORE_SCOPED)('$name は J-Alert 受信ログを閲覧できる（全国共通・店舗非依存）', async ({ user }) => {
    expect(ids(await asUser(user, 'select id from jalert_receipts'))).toEqual([JR_1])
  })

  it('recorders / recorder_cameras は担当店舗のエッジ配下だけに連鎖する', async () => {
    // viewer A1 の担当 A1 には REC_A1 がぶら下がる。baggage_manager A2 の担当 A2 には
    // レコーダが無いので空。エッジ可視性がそのまま連鎖することの確認。
    expect(ids(await asUser(U_VIEWA1, 'select id from recorders'))).toEqual([REC_A1])
    expect(ids(await asUser(U_VIEWA1, 'select id from recorder_cameras'))).toEqual([CAM_A1])
    expect(await asUser(U_BMGRA2, 'select id from recorders')).toHaveLength(0)
  })

  it('session_limits は自テナント分が見える（tenant_id 一致・ロール非依存）', async () => {
    expect(ids(await asUser(U_VIEWA1, 'select tenant_id as id from session_limits'))).toEqual([T_A])
    expect(ids(await asUser(U_BMGRA2, 'select tenant_id as id from session_limits'))).toEqual([T_A])
  })

  it('【既知の非対称】live_sessions は store_manager だけが見える', async () => {
    // sessions_select の店舗節は `role = 'store_manager'` に限定されており、
    // stores/edges の store_ids 節（ロール非依存）と揃っていない。本番の実挙動が
    // これなので、まず事実として固定する。揃えるなら migration + 本テストを同時に直す。
    expect(await asUser(U_SMGRA1, 'select id from live_sessions')).toHaveLength(1)
    expect(await asUser(U_VIEWA1, 'select id from live_sessions')).toHaveLength(0)
    expect(await asUser(U_BMGRA2, 'select id from live_sessions')).toHaveLength(0)
  })

  it('admin_users.role の CHECK 制約が5ロールすべてを受け付ける', async () => {
    // アプリ（zod enum・UserForm・STORE_SCOPED_ROLES）は5ロール前提なのに、
    // DB の CHECK が4値のままで baggage_manager が作成不能だった回帰を防ぐ。
    const probe = '00000000-0000-0000-0000-0000000000f0'
    await pool.query(`insert into auth.users (id) values ('${probe}') on conflict do nothing`)
    for (const role of ['super_admin', 'tenant_admin', 'store_manager', 'baggage_manager', 'viewer']) {
      await pool.query(`
        insert into public.admin_users (auth_user_id, role, tenant_id, store_ids)
        values ('${probe}', '${role}', '${T_A}', '{}')
      `)
      await pool.query(`delete from public.admin_users where auth_user_id = '${probe}'`)
    }
    await expect(
      pool.query(`insert into public.admin_users (auth_user_id, role) values ('${probe}', 'not_a_role')`),
    ).rejects.toThrow(/admin_users_role_check/)
  })
})

describe('recorders / recorder_cameras は edge 可視性に連鎖', () => {
  it('tenant_admin A は自テナントのみ（B テナントのレコーダ/カメラは不可視）', async () => {
    expect(ids(await asUser(U_TADMINA, 'select id from recorders'))).toEqual([REC_A1])
    expect(ids(await asUser(U_TADMINA, 'select id from recorder_cameras'))).toEqual([CAM_A1])
  })
  it('tenant_admin B は B のみ / super_admin は全件', async () => {
    expect(ids(await asUser(U_TADMINB, 'select id from recorders'))).toEqual([REC_B1])
    expect(ids(await asUser(U_SUPER, 'select id from recorder_cameras'))).toEqual([CAM_A1, CAM_B1].sort())
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

describe('edge_jobs RLS（エッジ専用スコープ鍵化 Phase B1）', () => {
  it('エッジA1 は自分宛の edge_jobs のみ可視（他エッジ不可視）', async () => {
    expect(ids(await asEdge(E_A1, 'select id from edge_jobs'))).toEqual([J_A1])
  })
  it('エッジB1 は自分宛のみ（A の job は不可視＝クロスエッジ漏洩なし）', async () => {
    expect(ids(await asEdge(E_B1, 'select id from edge_jobs'))).toEqual([J_B1])
  })
  it('app_metadata.edge_id 無しのトークンは何も見えない', async () => {
    expect(await asEdge(null, 'select id from edge_jobs')).toHaveLength(0)
  })
  it('エッジA1 は他エッジ宛ジョブを UPDATE できない（0行）', async () => {
    const rows = await asEdge(E_A1, `update edge_jobs set status='running' where id='${J_B1}' returning id`)
    expect(rows).toHaveLength(0)
  })
  it('エッジA1 は自分宛ジョブを UPDATE できる（1行）', async () => {
    const rows = await asEdge(E_A1, `update edge_jobs set status='running' where id='${J_A1}' returning id`)
    expect(ids(rows)).toEqual([J_A1])
  })
})

/**
 * 命令の受領記録（外部レビュー #6 の是正で追加）。
 *
 * ここが無かったせいで、**本番で 3 件の受領記録が永久に未決着のまま**になった
 * （2026-08-14 発見）。エッジは insert はできるが update が 0 行一致で無音に
 * 失敗していた。原因は **`update ... where` が select ポリシーも要求する**こと。
 * 当時この表には super_admin 用の select しか無かった。
 *
 * ★ 「insert できる」だけを見ると健全に見える。決着まで通ることを固定する。
 */
describe('edge_command_runs RLS（命令の受領記録）', () => {
  it('エッジA1 は自分の受領記録を insert できる', async () => {
    const rows = await asEdge(
      E_A1,
      `insert into edge_command_runs (request_id, edge_id, action)
         values ('9c000000-0000-0000-0000-0000000000c1', '${E_A1}', 'start_live')
         returning request_id`,
    )
    expect(rows).toHaveLength(1)
  })

  it('★自分の受領記録を UPDATE で決着できる（select ポリシー欠落の回帰）', async () => {
    // これが落ちるときの症状は「エラーも出ないし行も変わらない」。
    // finished_at が永久に NULL になり、命令が届いた後どうなったのかを
    // 二度と切り分けられなくなる。
    const rows = await asEdge(
      E_A1,
      `update edge_command_runs set finished_at = now(), ok = true
         where request_id = '${R_A1}' returning request_id`,
    )
    expect(ids(rows, 'request_id')).toEqual([R_A1])
  })

  it('自分の受領記録は見えるが、他エッジの分は見えない', async () => {
    expect(ids(await asEdge(E_A1, 'select request_id from edge_command_runs'), 'request_id'))
      .toEqual([R_A1])
    expect(ids(await asEdge(E_B1, 'select request_id from edge_command_runs'), 'request_id'))
      .toEqual([R_B1])
  })

  it('他エッジの受領記録は決着できない（0行）', async () => {
    expect(await asEdge(E_A1, `update edge_command_runs set ok = true
                                 where request_id='${R_B1}' returning request_id`))
      .toHaveLength(0)
  })

  it('他エッジ名義の受領は insert できない（受領の捏造を塞ぐ）', async () => {
    await expect(
      asEdge(E_A1, `insert into edge_command_runs (request_id, edge_id, action)
                      values ('9c000000-0000-0000-0000-0000000000c2', '${E_B1}', 'start_grid')
                      returning request_id`),
    ).rejects.toThrow(/row-level security/)
  })

  it('app_metadata.edge_id 無しのトークンは何も見えない', async () => {
    expect(await asEdge(null, 'select request_id from edge_command_runs')).toHaveLength(0)
  })
})

describe('エッジ専用スコープ鍵化 Phase B2（残りのテーブルを 1エッジ・1店舗 に限定）', () => {
  it('自分の edge_devices 行だけ見える（同テナントの別エッジも不可視）', async () => {
    expect(ids(await asEdge(E_A1, 'select id from edge_devices'))).toEqual([E_A1])
  })
  it('自己申告列（status/last_seen_at 等）は更新できる', async () => {
    const rows = await asEdge(
      E_A1,
      `update edge_devices set status='grid', last_seen_at=now(), agent_version='1.2.3'
         where id='${E_A1}' returning id`,
    )
    expect(ids(rows)).toEqual([E_A1])
  })
  it('store_id の付け替えはトリガで拒否（他店舗への昇格を塞ぐ）', async () => {
    await expect(
      asEdge(E_A1, `update edge_devices set store_id='${S_B1}' where id='${E_A1}' returning id`),
    ).rejects.toThrow(/edge token may only update/)
  })
  it('★device_token_hash を自分で書き換えられない（トークンの自己再発行を塞ぐ）', async () => {
    // 新しい列は自己申告ホワイトリストに入らない＝既定で保護側に倒れる、の実証。
    // ここが通ると、エッジが自分の認証子を任意の値に付け替えられる（M-5）。
    await expect(
      asEdge(E_A1, `update edge_devices set device_token_hash='deadbeef' where id='${E_A1}' returning id`),
    ).rejects.toThrow(/edge token may only update/)
  })

  it('device_token / camera_tier の書換えもトリガで拒否', async () => {
    await expect(
      asEdge(E_A1, `update edge_devices set device_token='stolen' where id='${E_A1}' returning id`),
    ).rejects.toThrow(/edge token may only update/)
    await expect(
      asEdge(E_A1, `update edge_devices set camera_tier=48 where id='${E_A1}' returning id`),
    ).rejects.toThrow(/edge token may only update/)
  })
  it('scoped_only を自分で false に戻せない（B4 を解除して service_role を取り返す経路を塞ぐ）', async () => {
    // 新しい列は自己申告ホワイトリストに入らない＝既定で保護側に倒れる、の実証。
    // 注: 同じ値への UPDATE は差分ゼロでトリガを素通りするため、true→false を試す。
    await expect(
      asEdge(E_A1, `update edge_devices set scoped_only=false where id='${E_A1}' returning id`),
    ).rejects.toThrow(/edge token may only update/)
  })
  it('他エッジの行は UPDATE 対象にすらならない（0行・トリガ以前にRLSで落ちる）', async () => {
    expect(await asEdge(E_A1, `update edge_devices set status='grid' where id='${E_B1}' returning id`))
      .toHaveLength(0)
  })

  it('recorders / recorder_cameras は自エッジ配下のみ', async () => {
    expect(ids(await asEdge(E_A1, 'select id from recorders'))).toEqual([REC_A1])
    expect(ids(await asEdge(E_A1, 'select id from recorder_cameras'))).toEqual([CAM_A1])
    expect(ids(await asEdge(E_B1, 'select id from recorders'))).toEqual([REC_B1])
  })
  it('stores は自店舗のみ（tenant_id 解決に必要な最小範囲）', async () => {
    expect(ids(await asEdge(E_A1, 'select id from stores'))).toEqual([S_A1])
  })

  it('inspection_clip_jobs / inspection_clips は自店舗のみ', async () => {
    expect(ids(await asEdge(E_A1, 'select id from inspection_clip_jobs'))).toEqual([CJ_A1])
    expect(ids(await asEdge(E_A1, 'select id from inspection_clips'))).toEqual([CL_A1])
  })
  it('他店舗のジョブは UPDATE できない（0行）', async () => {
    expect(await asEdge(E_A1, `update inspection_clip_jobs set status='done' where id='${CJ_B1}' returning id`))
      .toHaveLength(0)
    expect(ids(await asEdge(E_A1, `update inspection_clip_jobs set status='done' where id='${CJ_A1}' returning id`)))
      .toEqual([CJ_A1])
  })
  it('他テナントの tenant_id を載せた clips は INSERT できない', async () => {
    await expect(
      asEdge(E_A1, `insert into inspection_clips (tenant_id, store_id, session_id, camera_id, storage_path)
                    values ('${T_B}','${S_A1}','${SES_A1}','${CAM_A1}','x.mp4') returning id`),
    ).rejects.toThrow(/row-level security/)
  })
  it('他店舗の clips は INSERT できない', async () => {
    await expect(
      asEdge(E_A1, `insert into inspection_clips (tenant_id, store_id, session_id, camera_id, storage_path)
                    values ('${T_B}','${S_B1}','${SES_B1}','${CAM_B1}','x.mp4') returning id`),
    ).rejects.toThrow(/row-level security/)
  })
  it('自店舗・自テナントの clips は INSERT できる', async () => {
    const rows = await asEdge(
      E_A1,
      `insert into inspection_clips (tenant_id, store_id, session_id, camera_id, storage_path)
       values ('${T_A}','${S_A1}','${SES_A1}','${CAM_A1}','ok.mp4') returning id`,
    )
    expect(rows).toHaveLength(1)
  })

  it('vod_clips は自エッジ配下カメラの行のみ（他エッジの行は UPDATE 不可）', async () => {
    expect(ids(await asEdge(E_A1, 'select id from vod_clips'))).toEqual([VC_A1])
    expect(await asEdge(E_A1, `update vod_clips set status='ready' where id='${VC_B1}' returning id`))
      .toHaveLength(0)
  })

  it('bcp_events / bcp_clips は自店舗のイベント配下のみ', async () => {
    expect(ids(await asEdge(E_A1, 'select id from bcp_events'))).toEqual([BE_A1])
    expect(ids(await asEdge(E_A1, 'select id from bcp_clips'))).toEqual([BC_A1])
    expect(await asEdge(E_A1, `update bcp_events set status='failed' where id='${BE_B1}' returning id`))
      .toHaveLength(0)
    expect(await asEdge(E_A1, `delete from bcp_clips where id='${BC_B1}' returning id`)).toHaveLength(0)
    expect(ids(await asEdge(E_A1, `delete from bcp_clips where id='${BC_A1}' returning id`))).toEqual([BC_A1])
  })
  it('他店舗イベント配下の bcp_clips は INSERT できない', async () => {
    await expect(
      asEdge(E_A1, `insert into bcp_clips (event_id, camera_id) values ('${BE_B1}','${CAM_B1}') returning id`),
    ).rejects.toThrow(/row-level security/)
  })

  it('app_metadata.edge_id 無しのトークンはどの表も見えない', async () => {
    for (const t of ['edge_devices', 'recorders', 'stores', 'inspection_clip_jobs',
                     'inspection_clips', 'vod_clips', 'bcp_events', 'bcp_clips']) {
      expect(await asEdge(null, `select id from ${t}`)).toHaveLength(0)
    }
  })
  it('管理ユーザ(store_manager)にはエッジ用ポリシーが効かない（従来の可視範囲のまま）', async () => {
    // jwt_edge_id() が NULL のため edge_* ポリシーは一切マッチしない＝既存モデルを壊さない。
    expect(ids(await asUser(U_SMGRA1, 'select id from edge_devices'))).toEqual([E_A1])
  })
})

describe('jalert_receipts RLS（全国受信ログ＝ログイン管理ユーザは全員可視・回帰防止）', () => {
  // u.id 誤用（auth.uid と不一致）だと全行が不可視になり /bcp/jalerts がゼロ表示になる。
  // auth_user_id 判定なら各ロールが受信ログを閲覧できることを実証する。
  it('super_admin は受信ログを閲覧できる', async () => {
    expect(ids(await asUser(U_SUPER, 'select id from jalert_receipts'))).toEqual([JR_1])
  })
  it('tenant_admin は受信ログを閲覧できる（店舗非依存・全国共通）', async () => {
    expect(ids(await asUser(U_TADMINA, 'select id from jalert_receipts'))).toEqual([JR_1])
  })
  it('store_manager も受信ログを閲覧できる', async () => {
    expect(ids(await asUser(U_SMGRA1, 'select id from jalert_receipts'))).toEqual([JR_1])
  })
  it('未認証(anon)は受信ログを見られない', async () => {
    expect(await asUser(null, 'select id from jalert_receipts')).toHaveLength(0)
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
