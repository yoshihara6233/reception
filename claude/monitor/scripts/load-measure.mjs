/**
 * 上限まわりのスループット計測。**GA 前に一度、検証環境に対して**走らせる。
 *
 * 正しさ（同時に来ても上限を超えないか）は自動テストが常時見ている:
 *   tests/schema-meta/concurrency.test.ts … DB 側の契約
 *   e2e/session-limit.spec.ts             … 実サーバを通した契約
 * ここで見るのは**速さのほう**——判定を直列化したことが詰まりの元に
 * なっていないか。数字はローカルスタックのもので、本番（Supabase Tokyo +
 * Vercel）の容量ではない。**相対的な形だけを読むこと。**
 *
 * ⚠ 本番に向けて走らせないこと。書き込み（セッション行・レート計上）を伴う。
 *
 *   bunx supabase start && bunx supabase db reset
 *   bash scripts/e2e-dev.sh 3210 &        # HTTP の計測に使う
 *   ./node_modules/.bin/playwright test --project=setup   # ログイン状態を作る
 *   node scripts/load-measure.mjs
 */
import { Pool } from 'pg'

const DB_URL = process.env.SUPABASE_DB_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
// 向き先を間違えたまま走らせるのは事故そのもの。疑わしい時点で止める。
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
  console.error(`ERROR: ローカル以外の DB を指しています: ${DB_URL.replace(/:[^:@]*@/, ':***@')}`)
  process.exit(1)
}
const pool = new Pool({ connectionString: DB_URL, max: 60 })

const TENANT = '00000000-0000-0000-0000-0000000000dd'
const STORE  = '00000000-0000-0000-0000-0000000000de'
const USER   = '00000000-0000-0000-0000-0000000000df'

await pool.query(`insert into public.tenants (id,name,plan,status) values ($1,'負荷計測','standard','active') on conflict (id) do nothing`, [TENANT])
await pool.query(`insert into public.stores (id,tenant_id,name) values ($1,$2,'負荷計測店舗') on conflict (id) do nothing`, [STORE, TENANT])
await pool.query(`insert into public.session_limits (tenant_id,max_concurrent) values ($1,1000) on conflict (tenant_id) do update set max_concurrent=1000`, [TENANT])

const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]
const show = (label, lat, ms) => console.log(
  `${label.padEnd(34)} ${String(lat.length).padStart(5)}件 ${String(Math.round(lat.length / ms * 1000)).padStart(5)}/秒  `
  + `p50 ${pct(lat, .5).toFixed(1)}ms  p95 ${pct(lat, .95).toFixed(1)}ms  max ${Math.max(...lat).toFixed(1)}ms`)

async function run(label, total, conc, fn) {
  const lat = []
  const t0 = performance.now()
  let i = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < total) {
      const n = i++
      const s = performance.now()
      await fn(n)
      lat.push(performance.now() - s)
    }
  }))
  show(label, lat, performance.now() - t0)
}

console.log('── DB 直（ローカル Postgres）────────────────────────────────')
await run('rate_limit_hit 同一キー', 2000, 50, () =>
  pool.query(`select public.rate_limit_hit('load:same', 999999, '1 hour'::interval)`))
await run('rate_limit_hit キー分散', 2000, 50, (n) =>
  pool.query(`select public.rate_limit_hit($1, 999999, '1 hour'::interval)`, [`load:${n % 500}`]))

async function startSession() {
  const c = await pool.connect()
  try {
    await c.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: USER, role: 'authenticated' })])
    await c.query('select * from public.start_live_session($1, $2)', [STORE, 'live'])
  } finally { c.release() }
}
await run('start_live_session 同一テナント', 1000, 20, startSession)
const { rows: [{ n }] } = await pool.query('select count(*)::int n from public.live_sessions where store_id=$1', [STORE])
console.log(`  → 作成 ${n} 件（上限 1000 に対し、ロック待ちで落ちた分は無し）`)

console.log('\n── HTTP（next dev・本番の Vercel とは別物）────────────────')
const { readFileSync } = await import('node:fs')
const st = JSON.parse(readFileSync('e2e/.auth/storeA1.json', 'utf8'))
const cookie = st.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
const A1 = '00000000-0000-0000-0000-0000000000c1'
const TENANT_A = '00000000-0000-0000-0000-0000000000b1'
await pool.query(`delete from public.live_sessions ls using public.stores s where s.id=ls.store_id and s.tenant_id=$1`, [TENANT_A])

const codes = new Map()
await run('POST /api/sessions (live)', 300, 20, async () => {
  const r = await fetch('http://localhost:3210/api/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'start', mode: 'live', storeId: A1 }),
  })
  codes.set(r.status, (codes.get(r.status) ?? 0) + 1)
  await r.arrayBuffer()
})
console.log(`  → 応答: ${[...codes].map(([k, v]) => `${k}×${v}`).join(' ')}（上限 5 なので大半が 429 で正しい）`)

await pool.query(`delete from public.live_sessions ls using public.stores s where s.id=ls.store_id and s.tenant_id=$1`, [TENANT_A])
await pool.query('delete from public.live_sessions where store_id=$1', [STORE])
await pool.query('delete from public.tenants where id=$1', [TENANT])
await pool.query(`delete from public.rate_limits where key like 'load:%'`)
await pool.end()
