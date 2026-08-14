import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

/**
 * 証跡の取りこぼしの検知。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① 取得を指示したのに届いていない証跡を**数え落とさない**
 * ② **まだ撮る時刻が来ていないものを欠落と呼ばない**
 *
 * ②が①と同じくらい重要。BCP は最大 +30 分オフセットまであるので、一律の猶予で
 * 判定すると発生直後に必ず誤検知する。誤検知が続く通知は読まれなくなり、
 * 結果として本物も見落とす。だから「撮る時刻を過ぎたか」を行ごとに見る。
 *
 * ── 実際に踏んだ間違い ──────────────────────────────────────────────────
 * 最初 `alarm_frames.alarm_id` で書いて migration が落ちた（正しくは
 * `alarm_event_id`）。さらに「行が 0 件か」で判定していたため、**届いたが
 * 全部 failed** を正常と読む形になっていた。ここは `completed` の有無で見る。
 */

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

interface Gaps {
  alarms: { recent: number; older: number; worst: { store: string; occurred_at: string }[] }
  bcp:    { recent: number; older: number; not_due: number; worst: { store: string; offset_min: number }[] }
}

const gaps = async (days = 7, grace = 30): Promise<Gaps> => {
  const { rows } = await pool.query('select public.evidence_gaps($1, $2) as g', [days, grace])
  return rows[0].g as Gaps
}

let tenantId = ''
let storeId = ''
let edgeId = ''

beforeAll(async () => {
  // plan は明示する。DB 既定の 'trial' は tenants_plan_check を通らない
  // （api/admin/tenants/route.ts に同じ注意書きがある既知の罠）。
  const t = await pool.query(
    `insert into public.tenants (name, plan) values ('証跡欠落テスト', 'starter') returning id`)
  tenantId = t.rows[0].id
  const s = await pool.query(
    `insert into public.stores (tenant_id, name) values ($1, '欠落テスト店') returning id`, [tenantId])
  storeId = s.rows[0].id
  const e = await pool.query(
    // device_token_hash は NOT NULL（M-5）。平文列は段階2で消えている。
    `insert into public.edge_devices (store_id, name, device_token_hash)
     select $1, 'gap-edge', encode(sha256(convert_to(t, 'UTF8')), 'hex')
       from (select 'gap-' || gen_random_uuid()::text as t) s
     returning id`, [storeId])
  edgeId = e.rows[0].id
})

afterEach(async () => {
  await pool.query('delete from public.alarm_frames where alarm_event_id in (select id from public.alarm_events where store_id = $1)', [storeId])
  await pool.query('delete from public.alarm_events where store_id = $1', [storeId])
  await pool.query('delete from public.bcp_clips where event_id in (select id from public.bcp_events where store_id = $1)', [storeId])
  await pool.query('delete from public.bcp_events where store_id = $1', [storeId])
  await pool.query('delete from public.edge_command_runs where edge_id = $1', [edgeId])
})

afterAll(async () => {
  await pool.query('delete from public.edge_devices where id = $1', [edgeId])
  await pool.query('delete from public.stores where id = $1', [storeId])
  await pool.query('delete from public.tenants where id = $1', [tenantId])
  await pool.end()
})

/** 発報を 1 件作る。dispatchedMinAgo が null なら「まだ送っていない」。 */
async function alarm(dispatchedMinAgo: number | null): Promise<string> {
  const { rows } = await pool.query(
    `insert into public.alarm_events (store_id, source, occurred_at, timeline_dispatched_at)
     values ($1, 'onvif', now() - interval '1 hour',
             case when $2::int is null then null else now() - make_interval(mins => $2::int) end)
     returning id`, [storeId, dispatchedMinAgo])
  return rows[0].id
}

/** BCP クリップを 1 件作る。createdMinAgo 分前に作られ、offset_min のオフセットを持つ。 */
async function bcpClip(createdMinAgo: number, offsetMin: number, status = 'pending'): Promise<void> {
  const { rows } = await pool.query(
    `insert into public.bcp_events (store_id, alert_type, alert_issued_at)
     values ($1, 'quake', now()) returning id`, [storeId])
  await pool.query(
    `insert into public.bcp_clips (event_id, clip_from, clip_to, offset_min, upload_status, created_at)
     values ($1, now(), now(), $2, $3, now() - make_interval(mins => $4))`,
    [rows[0].id, offsetMin, status, createdMinAgo])
}

describe('evidence_gaps — 発報の前後スナップ', () => {
  it('★送ったのにスナップが 1 枚も無ければ数える', async () => {
    await alarm(60)
    const g = await gaps()
    expect(g.alarms.recent).toBe(1)
    expect(g.alarms.worst[0].store).toBe('欠落テスト店')
  })

  it('★届いたが全部 failed も欠落として数える（行の有無で見ない）', async () => {
    const id = await alarm(60)
    await pool.query(
      `insert into public.alarm_frames (alarm_event_id, offset_sec, status)
       values ($1, 0, 'failed'), ($1, 5, 'failed')`, [id])
    expect((await gaps()).alarms.recent).toBe(1)
  })

  it('completed が 1 枚でもあれば欠落ではない', async () => {
    const id = await alarm(60)
    await pool.query(
      `insert into public.alarm_frames (alarm_event_id, offset_sec, status)
       values ($1, 0, 'completed'), ($1, 5, 'failed')`, [id])
    expect((await gaps()).alarms.recent).toBe(0)
  })

  it('★猶予内なら数えない（撮影は発報の 3 分後まで続く）', async () => {
    await alarm(5)     // 5 分前に送った・猶予 30 分
    expect((await gaps()).alarms.recent).toBe(0)
  })

  it('まだ送っていない発報は対象外（リトライ cron の担当）', async () => {
    await alarm(null)
    expect((await gaps()).alarms.recent).toBe(0)
  })

  it('古いものは recent ではなく older に入る（導入初日に過去分で埋めない）', async () => {
    await alarm(60 * 24 * 30)   // 30 日前
    const g = await gaps(7)
    expect(g.alarms.recent).toBe(0)
    expect(g.alarms.older).toBe(1)
  })
})

describe('evidence_gaps — BCP クリップ', () => {
  it('★撮る時刻を過ぎて pending のままなら数える', async () => {
    await bcpClip(120, 0)      // 2 時間前・オフセット 0
    const g = await gaps()
    expect(g.bcp.recent).toBe(1)
    expect(g.bcp.not_due).toBe(0)
  })

  it('+30 分オフセットは、その時刻が来るまで欠落と呼ばない', async () => {
    await bcpClip(10, 30)
    const g = await gaps()
    expect(g.bcp.recent).toBe(0)
    expect(g.bcp.not_due).toBe(1)
  })

  it('★一律猶予なら誤検知する条件で、誤検知しない', async () => {
    // 45 分前に作られた +30 分のコマ。
    //   正しい判定: 撮影時刻(+30分) + 猶予(30分) = 作成から 60 分後 → まだ来ていない
    //   一律猶予 :  作成 + 猶予(30分) = 15 分前に過ぎている → **欠落と誤判定**
    // 上の「10 分前」のケースはどちらの実装でも not_due になり判別できない
    // （変異テストで気づいた）。誤検知が出る条件をここで固定する。
    await bcpClip(45, 30)
    const g = await gaps()
    expect(g.bcp.recent).toBe(0)
    expect(g.bcp.not_due).toBe(1)
  })

  it('★+30 分でも、その時刻＋猶予を過ぎれば数える', async () => {
    await bcpClip(30 + 30 + 5, 30)
    expect((await gaps()).bcp.recent).toBe(1)
  })

  it('-5 分（発令前）のコマは早期に判定できる', async () => {
    await bcpClip(45, -5)
    expect((await gaps()).bcp.recent).toBe(1)
  })

  it('completed / failed は対象外（pending だけを見る）', async () => {
    await bcpClip(120, 0, 'completed')
    await bcpClip(120, 0, 'failed')
    const g = await gaps()
    expect(g.bcp.recent).toBe(0)
    expect(g.bcp.not_due).toBe(0)
  })

  /** offset_min を持たないプレースホルダ行を 1 件作る。 */
  async function placeholder(createdMinAgo: number): Promise<void> {
    const { rows } = await pool.query(
      `insert into public.bcp_events (store_id, alert_type, alert_issued_at)
       values ($1, 'quake', now()) returning id`, [storeId])
    await pool.query(
      `insert into public.bcp_clips (event_id, clip_from, clip_to, upload_status, created_at)
       values ($1, now(), now(), 'pending', now() - make_interval(mins => $2))`,
      [rows[0].id, createdMinAgo])
  }

  it('offset_min が NULL のプレースホルダも、十分に古ければ数える', async () => {
    await placeholder(120)
    expect((await gaps()).bcp.recent).toBe(1)
  })

  it('★NULL を 0 分とみなさない（撮影中の正常な行を欠落と呼ばない）', async () => {
    // NULL 行は発令時に作られるカメラ単位のプレースホルダで、エッジは
    // **全オフセットの撮影を終えてから**削除する（2026-06-27 の是正）。
    // 45 分前 = 0 分扱いなら「撮影時刻＋猶予 30 分」を過ぎて欠落と誤判定。
    // 最大オフセット 30 分扱いなら 30+30=60 分後まで待つので、まだ正常。
    // 本番の実データ（2026-06-27 の残骸 3 件）を見て気づいた穴。
    await placeholder(45)
    const g = await gaps()
    expect(g.bcp.recent).toBe(0)
    expect(g.bcp.not_due).toBe(1)
  })
})

describe('edge_command_runs — 命令の受領記録', () => {
  it('同じ request_id を二度書いても壊れない（重複拾い）', async () => {
    const rid = (await pool.query('select gen_random_uuid() as id')).rows[0].id
    await pool.query(
      `insert into public.edge_command_runs (request_id, edge_id, action)
       values ($1, $2, 'start_bcp_capture') on conflict (request_id) do nothing`, [rid, edgeId])
    await pool.query(
      `insert into public.edge_command_runs (request_id, edge_id, action)
       values ($1, $2, 'start_bcp_capture') on conflict (request_id) do nothing`, [rid, edgeId])
    const { rows } = await pool.query(
      'select count(*)::int as n from public.edge_command_runs where edge_id = $1', [edgeId])
    expect(rows[0].n).toBe(1)
  })

  it('★受け取ったまま終わっていない実行が残る（拾った直後に落ちた形）', async () => {
    await pool.query(
      `insert into public.edge_command_runs (request_id, edge_id, action, claimed_at)
       values (gen_random_uuid(), $1, 'capture_alarm_timeline', now() - interval '2 hours')`, [edgeId])
    const { rows } = await pool.query(
      `select count(*)::int as n from public.edge_command_runs
        where edge_id = $1 and finished_at is null`, [edgeId])
    expect(rows[0].n).toBe(1)
  })

  it('掃除は保持期間より古い行だけを消す', async () => {
    await pool.query(
      `insert into public.edge_command_runs (request_id, edge_id, action, claimed_at)
       values (gen_random_uuid(), $1, 'start_live', now() - interval '20 days'),
              (gen_random_uuid(), $1, 'start_live', now() - interval '2 days')`, [edgeId])
    await pool.query('select public.prune_edge_command_runs(14)')
    const { rows } = await pool.query(
      'select count(*)::int as n from public.edge_command_runs where edge_id = $1', [edgeId])
    expect(rows[0].n).toBe(1)
  })
})
