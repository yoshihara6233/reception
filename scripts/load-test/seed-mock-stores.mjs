#!/usr/bin/env node
/**
 * F50.D: モック店舗 一括 INSERT
 *
 * 負荷試験用に N 店舗 (deployment_mode='central_aggregator', NVR は mock サーバ)
 * を Supabase に投入する。テスト後は cleanup で削除。
 *
 * Usage:
 *   node scripts/load-test/seed-mock-stores.mjs --count=1000 --base-port=18443
 *   node scripts/load-test/seed-mock-stores.mjs --cleanup
 */
import { createClient } from '@supabase/supabase-js'
import process from 'process'

const args = process.argv.slice(2)
const opts = {
  count:    1000,
  basePort: 18443,
  vendor:   'i-pro-nx',
  model:    'WJ-NX300K',
  cleanup:  false,
  host:     '127.0.0.1',
}
for (const a of args) {
  if (a.startsWith('--count='))     opts.count = parseInt(a.slice(8), 10)
  else if (a.startsWith('--base-port=')) opts.basePort = parseInt(a.slice(12), 10)
  else if (a.startsWith('--vendor=')) opts.vendor = a.slice(9)
  else if (a.startsWith('--model='))  opts.model = a.slice(8)
  else if (a.startsWith('--host='))   opts.host = a.slice(7)
  else if (a === '--cleanup')         opts.cleanup = true
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function cleanup() {
  console.log('Removing all mock stores (name LIKE "load-test-%")...')
  const { error, count } = await supa
    .from('stores')
    .delete({ count: 'exact' })
    .like('name', 'load-test-%')
  if (error) { console.error(error); process.exit(1) }
  console.log(`Deleted ${count} mock stores`)
}

async function seed() {
  console.log(`Inserting ${opts.count} mock stores...`)
  const batchSize = 200
  let inserted = 0
  const startTime = Date.now()
  for (let offset = 0; offset < opts.count; offset += batchSize) {
    const batch = []
    for (let i = 0; i < batchSize && offset + i < opts.count; i++) {
      const n = offset + i + 1
      batch.push({
        name:            `load-test-${String(n).padStart(5, '0')}`,
        area_code:       n % 47 === 0 ? 'OKINAWA' : 'TOKYO',
        is_active:       true,
        deployment_mode: 'central_aggregator',
        nvr_vendor:      opts.vendor,
        nvr_model:       opts.model,
        nvr_endpoint:    `http://${opts.host}:${opts.basePort + (n - 1)}`,
        nvr_options:     {},
      })
    }
    const { error, count } = await supa.from('stores').insert(batch, { count: 'exact' })
    if (error) {
      console.error(`Batch ${offset}: ${error.message}`)
      break
    }
    inserted += count ?? batch.length
    if (inserted % 500 === 0 || inserted >= opts.count) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = (inserted / elapsed).toFixed(1)
      console.log(`  ${inserted} / ${opts.count}  (${rate} stores/sec)`)
    }
  }
  const elapsed = (Date.now() - startTime) / 1000
  console.log(`\nSeeded ${inserted} stores in ${elapsed.toFixed(1)}s`)
  console.log(`Each store points to http://${opts.host}:<basePort+N>`)
  console.log(`\nNext: launch mock-nvr-server with --multi=${opts.count} --base-port=${opts.basePort}`)
  console.log(`Then: launch edge-agent with CENTRAL_NODE_ID=... and watch /metrics`)
}

if (opts.cleanup) await cleanup()
else              await seed()
