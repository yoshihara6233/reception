import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * パーティション監視 cron が **異常のときに実際に通知を出す**ことを、
 * ハンドラを呼んで確かめる。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * 2026-08-09、このルートをローカルの実サーバに叩いて「動いた」と判断したが、
 * そのとき ALERT_EMAILS が未設定で **通知の分岐を一度も通っていなかった**。
 * sendEmail の呼び出しは引数の形が違っており（オブジェクトを渡していた）、
 * typecheck が拾わなければ「異常を検出したのに通知だけ落ちる」監視になっていた。
 *
 * 監視の値打ちは異常時の挙動にしかない。正常系だけ確かめて良しとしない。
 *
 * DB もメールも外に出さず、境界（RPC・送信）をモックして分岐だけを見る。
 */

const h = vi.hoisted(() => ({
  rpcResult: null as unknown,
  /** schema_invariants() の戻り。partition_health() とは別物なので分けて持つ。 */
  schemaResult: null as unknown,
  rpcError: null as { message: string } | null,
  schemaError: null as { message: string } | null,
  emails: [] as { to: string | string[]; subject: string; html: string }[],
  webhooks: [] as string[],
}))

// ルートは 2 つの RPC を呼ぶ。**名前で分けないと、片方の答えをもう片方に
// 返してしまい、テストが実物と違う形を見ることになる**。
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    rpc: async (name: string) => (name === 'schema_invariants'
      ? { data: h.schemaResult, error: h.schemaError }
      : { data: h.rpcResult, error: h.rpcError }),
  }),
}))
vi.mock('@/lib/email/send', () => ({
  SECURITY_FROM_ADDRESS: 'test@example.com',
  sendEmail: async (to: string | string[], subject: string, html: string) => {
    h.emails.push({ to, subject, html })
    return { ok: true }
  },
}))
vi.mock('@/lib/ops/webhook', () => ({
  sendOpsWebhook: async (text: string) => { h.webhooks.push(text); return true },
}))

const SECRET = 'test-cron-secret'
const HEALTHY = {
  pg_cron: true,
  tables: {
    live_sessions:   { last_partition: '202610', months_ahead: 2 },
    monitor_results: { last_partition: '202610', months_ahead: 2 },
  },
  jobs: {
    live_sessions_partition: true, monitor_results_partition: true,
    jalert_poll: true, bcp_report_sweep: true,
    monitor_sweep_edges: true, monitor_sweep_unattended_streams: true,
  },
  vault: {
    project_url: true, service_role_key: true,
    app_url: true, bcp_webhook_secret: true,
  },
}

/** 指摘ゼロのスキーマ。checked_at が無いと「監視自体が壊れた」判定になる。 */
const HEALTHY_SCHEMA = {
  checked_at: '2026-08-10T04:00:00Z',
  rls_disabled: [],
  no_policy: ['rate_limits', 'live_sessions_202608'],   // 台帳と正規表現で落ちる
  secdef_bad_search_path: [],
  missing_fk: [],
  partitioned_embed: [],
  unknown_embed_tables: [],
}

/** 本番で必須の env。未設定だと critical になるので、正常系では埋めておく。 */
const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'RESEND_API_KEY',
]

let savedSecret: string | undefined
let savedEmails: string | undefined
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  savedEmails = process.env.ALERT_EMAILS
  process.env.CRON_SECRET = SECRET
  process.env.ALERT_EMAILS = 'ops@example.com, oncall@example.com'
  savedEnv = Object.fromEntries(REQUIRED_ENV.map((k) => [k, process.env[k]]))
  for (const k of REQUIRED_ENV) process.env[k] = process.env[k] || 'set-for-test'
  h.rpcResult = HEALTHY
  h.schemaResult = HEALTHY_SCHEMA
  h.rpcError = null
  h.schemaError = null
  h.emails = []
  h.webhooks = []
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  if (savedEmails === undefined) delete process.env.ALERT_EMAILS
  else process.env.ALERT_EMAILS = savedEmails
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function call(headers: Record<string, string> = { 'x-cron-secret': SECRET }) {
  const { GET } = await import('@/app/api/cron/partition-health/route')
  const { NextRequest } = await import('next/server')
  return GET(new NextRequest('http://localhost/api/cron/partition-health', { headers }))
}

describe('/api/cron/partition-health', () => {
  it('secret 無しは 401', async () => {
    const res = await call({})
    expect(res.status).toBe(401)
    expect(h.emails).toHaveLength(0)
  })

  it('CRON_SECRET 未設定なら 503（誰でも叩ける状態にしない）', async () => {
    delete process.env.CRON_SECRET
    expect((await call({ 'x-cron-secret': 'anything' })).status).toBe(503)
  })

  it('正常なら通知を出さない', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).severity).toBe('ok')
    expect(h.emails).toHaveLength(0)
    expect(h.webhooks).toHaveLength(0)
  })

  it('異常ならメールと webhook の両方を出す', async () => {
    // **ここが本題**。以前はこの分岐を一度も通さずに「動いた」と判断していた。
    h.rpcResult = { ...HEALTHY, jobs: { ...HEALTHY.jobs, monitor_results_partition: false } }
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).severity).toBe('critical')

    expect(h.emails).toHaveLength(1)
    expect(h.emails[0].to).toEqual(['ops@example.com', 'oncall@example.com'])
    expect(h.emails[0].subject).toContain('monitor_results_partition')
    // 復旧手順が本文に入っていること（受け取った人がその場で動ける）。
    expect(h.emails[0].html).toContain('monitor_results_ensure_partition')

    expect(h.webhooks).toHaveLength(1)
    expect(h.webhooks[0]).toContain('monitor_results_partition')
  })

  it('ALERT_EMAILS 未設定でも webhook は出す（通知の複線化）', async () => {
    delete process.env.ALERT_EMAILS
    h.rpcResult = { ...HEALTHY, tables: {
      live_sessions:   { last_partition: '202608', months_ahead: 0 },
      monitor_results: { last_partition: '202610', months_ahead: 2 },
    } }
    await call()
    expect(h.emails).toHaveLength(0)
    expect(h.webhooks).toHaveLength(1)
  })

  it('RPC が失敗したら 500（監視が死んでいるのに緑を返さない）', async () => {
    h.rpcError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(500)
    err.mockRestore()
  })

  // ── ここから、本番スキーマと env の点検（2026-08-10 追加）─────────────

  it('★埋め込みの外部キーが欠けていたら鳴らす', async () => {
    // 同時視聴上限が本番で一度も発動しなかった原因そのもの。
    // 400 が握り潰されて「0 件」になるため、**本番では何も起きないように見える**。
    h.schemaResult = { ...HEALTHY_SCHEMA, missing_fk: ['live_sessions→stores'] }
    const res = await call()
    expect((await res.json()).severity).toBe('critical')
    expect(h.emails[0].subject).toContain('外部キー')
    expect(h.webhooks[0]).toContain('live_sessions→stores')
  })

  it('★RLS が無効な表があれば鳴らす', async () => {
    h.schemaResult = { ...HEALTHY_SCHEMA, rls_disabled: ['secret_table'] }
    expect((await (await call()).json()).severity).toBe('critical')
    expect(h.emails[0].html).toContain('secret_table')
  })

  it('★必須の環境変数が欠けていたら鳴らす', async () => {
    // env-check の台帳は /admin のレポートに出しているが、**見に行かないと
    // 気づけない**。鳴らす側に回す。
    delete process.env.RESEND_API_KEY
    const res = await call()
    expect((await res.json()).severity).toBe('critical')
    expect(h.emails[0].subject).toContain('RESEND_API_KEY')
    // 値そのものは通知に載せない。
    expect(h.emails[0].html).not.toContain('set-for-test')
  })

  it('スキーマ点検の結果が空なら「監視が壊れた」として鳴らす', async () => {
    // checked_at が無い＝関数の想定と実際がずれている。黙って ok にしない。
    h.schemaResult = {}
    expect((await (await call()).json()).severity).toBe('critical')
  })

  it('schema_invariants が失敗したら 500', async () => {
    h.schemaError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call()).status).toBe(500)
    err.mockRestore()
  })

  it('パーティションの子と台帳のテーブルは「ポリシー無し」で鳴らさない', async () => {
    // 事実としては返るが、判断側が落とす。ここが効かないと毎日誤報が出る。
    expect((await (await call()).json()).severity).toBe('ok')
    expect(h.emails).toHaveLength(0)
  })
})
