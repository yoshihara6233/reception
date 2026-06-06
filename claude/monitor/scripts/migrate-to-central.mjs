#!/usr/bin/env node
/**
 * F50.A: Mini PC モード → Central モード 移行 CLI
 *
 * 既存 deployment_mode='per_store_minipc' の店舗を 'central_aggregator' に
 * 切替える。central_node_id は NULL のままにして、ShardManager が自動 claim する。
 *
 * Usage:
 *   # dry-run (デフォルト)
 *   node scripts/migrate-to-central.mjs
 *
 *   # 実行
 *   node scripts/migrate-to-central.mjs --apply
 *
 *   # フィルタ (組合せ可能)
 *   node scripts/migrate-to-central.mjs --area=TOKYO --apply
 *   node scripts/migrate-to-central.mjs --vendor=i-pro-nx --limit=100 --apply
 *   node scripts/migrate-to-central.mjs --ids=uuid1,uuid2 --apply
 *
 *   # ロールバック (central → per_store_minipc に戻す)
 *   node scripts/migrate-to-central.mjs --rollback --ids=uuid1 --apply
 *
 * 前提:
 *   - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY が環境変数で利用可能
 *   - 各店舗の nvr_vendor / nvr_endpoint が設定済 (未設定店舗は skip + 警告)
 *
 * 動作:
 *   1. フィルタに該当する店舗を一覧
 *   2. NVR 設定有無を確認
 *   3. dry-run なら一覧表示のみ
 *   4. --apply なら UPDATE 実行
 *   5. 結果サマリを出力
 */
import { createClient } from '@supabase/supabase-js'
import process from 'process'

// ── オプションパース ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const opts = {
  apply:    false,
  rollback: false,
  area:     null,
  vendor:   null,
  ids:      null,
  limit:    null,
}
for (const a of args) {
  if (a === '--apply') opts.apply = true
  else if (a === '--rollback') opts.rollback = true
  else if (a.startsWith('--area='))   opts.area = a.slice(7)
  else if (a.startsWith('--vendor=')) opts.vendor = a.slice(9)
  else if (a.startsWith('--ids='))    opts.ids = a.slice(6).split(',').map((s) => s.trim()).filter(Boolean)
  else if (a.startsWith('--limit='))  opts.limit = parseInt(a.slice(8), 10)
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
  else { console.error(`Unknown option: ${a}`); process.exit(1) }
}

function printHelp() {
  console.log(`
Mini PC → Central モード 移行 CLI

Options:
  --apply              実際に UPDATE を実行 (省略時は dry-run)
  --rollback           central → per_store_minipc へロールバック
  --area=<code>        対象を area_code で絞り込み (例: TOKYO)
  --vendor=<vendor>    nvr_vendor で絞り込み (例: i-pro-nx)
  --ids=<u1,u2,...>    store.id を直接指定
  --limit=<n>          最大 N 店舗 (--apply 時の安全装置)
  -h, --help           このメッセージを表示
`)
}

// ── Supabase クライアント ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です')
  process.exit(1)
}
const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── 対象店舗の取得 ───────────────────────────────────────────────────────────
async function fetchTargets() {
  const fromMode = opts.rollback ? 'central_aggregator' : 'per_store_minipc'
  let q = supa
    .from('stores')
    .select('id, name, area_code, deployment_mode, nvr_vendor, nvr_endpoint, nvr_model, central_node_id')
    .eq('deployment_mode', fromMode)
    .order('name')

  if (opts.area)   q = q.eq('area_code', opts.area)
  if (opts.vendor) q = q.eq('nvr_vendor', opts.vendor)
  if (opts.ids?.length) q = q.in('id', opts.ids)
  if (opts.limit)  q = q.limit(opts.limit)

  const { data, error } = await q
  if (error) {
    console.error('SELECT エラー:', error.message)
    process.exit(1)
  }
  return data ?? []
}

// ── 移行可否チェック ─────────────────────────────────────────────────────────
function validateForMigration(store) {
  // central モードへの移行: NVR 設定必須
  if (!opts.rollback) {
    if (!store.nvr_vendor || store.nvr_vendor === 'frigate') {
      return { ok: false, reason: 'NVR ベンダー未設定 (または frigate のまま)' }
    }
    if (!store.nvr_endpoint) {
      return { ok: false, reason: 'NVR エンドポイント未設定' }
    }
  }
  return { ok: true }
}

// ── 表示用フォーマット ──────────────────────────────────────────────────────
function fmtStoreLine(s, mark = '') {
  const id8 = s.id.slice(0, 8)
  const area = s.area_code ?? '—'
  const vendor = s.nvr_vendor ?? '—'
  const model = s.nvr_model ?? '—'
  return `${mark}  ${id8} ${area.padEnd(8)} ${vendor.padEnd(14)} ${model.padEnd(14)} ${s.name}`
}

// ── メイン ──────────────────────────────────────────────────────────────────
async function main() {
  const direction = opts.rollback ? 'central → per_store_minipc' : 'per_store_minipc → central'
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`  移行 CLI (${opts.apply ? 'APPLY' : 'DRY-RUN'}): ${direction}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  const filterDesc = []
  if (opts.area)   filterDesc.push(`area=${opts.area}`)
  if (opts.vendor) filterDesc.push(`vendor=${opts.vendor}`)
  if (opts.ids)    filterDesc.push(`ids=${opts.ids.length}件`)
  if (opts.limit)  filterDesc.push(`limit=${opts.limit}`)
  if (filterDesc.length) console.log(`  フィルタ: ${filterDesc.join(' / ')}\n`)

  const targets = await fetchTargets()
  if (targets.length === 0) {
    console.log('  対象店舗 0 件 (フィルタを見直してください)\n')
    process.exit(0)
  }

  const eligible = []
  const skipped  = []
  for (const s of targets) {
    const check = validateForMigration(s)
    if (check.ok) eligible.push(s)
    else skipped.push({ ...s, _reason: check.reason })
  }

  console.log(`  対象 ${targets.length} 件 (移行可 ${eligible.length} / スキップ ${skipped.length})\n`)
  console.log(`  ${'ID'.padEnd(9)}${'AREA'.padEnd(9)}${'VENDOR'.padEnd(15)}${'MODEL'.padEnd(15)}NAME`)
  console.log(`  ${'-'.repeat(80)}`)
  for (const s of eligible) console.log(fmtStoreLine(s, '✓'))
  for (const s of skipped) {
    console.log(fmtStoreLine(s, '✗') + `  ← ${s._reason}`)
  }
  console.log()

  if (!opts.apply) {
    console.log(`  DRY-RUN モード: 何も変更していません`)
    console.log(`  実行する場合は --apply を追加してください\n`)
    process.exit(0)
  }

  // ── 実 UPDATE ──────────────────────────────────────────────────────────
  const newMode = opts.rollback ? 'per_store_minipc' : 'central_aggregator'
  const update = { deployment_mode: newMode }
  if (opts.rollback) update.central_node_id = null  // 担当解除

  const ids = eligible.map((s) => s.id)
  if (ids.length === 0) {
    console.log(`  ❗ 移行可能な店舗が 0 件です。終了します。\n`)
    process.exit(0)
  }

  console.log(`  ${ids.length} 店舗を UPDATE 中...`)
  const { error, count } = await supa
    .from('stores')
    .update(update, { count: 'exact' })
    .in('id', ids)

  if (error) {
    console.error(`  ❌ UPDATE 失敗: ${error.message}`)
    process.exit(1)
  }

  console.log(`\n  ✅ ${count} 店舗を ${newMode} へ移行しました`)
  if (!opts.rollback) {
    console.log(`  → 中央エージェントの ShardManager が自動的に capacity 内で claim します`)
    console.log(`  → /infra/nodes で割当状況を確認してください`)
  }
  console.log()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
