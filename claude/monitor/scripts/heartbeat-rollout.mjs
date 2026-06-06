#!/usr/bin/env node
/**
 * F51.B: ハートビート間隔 段階ロールアウト CLI
 *
 * 既定間隔 (deployment_mode 由来) を per-store にオーバーライドする。
 * 段階展開で「次の N 店舗を 60s から 6h に切り替え」といった運用ができる。
 *
 * Usage:
 *   # 現状確認
 *   node scripts/heartbeat-rollout.mjs --status
 *
 *   # 60秒に固定 (Mini PC モード相当)
 *   node scripts/heartbeat-rollout.mjs --set-to=60 --area=TOKYO --apply
 *
 *   # 6時間に固定 (中央集約モード相当)
 *   node scripts/heartbeat-rollout.mjs --set-to=21600 --limit=100 --apply
 *
 *   # オーバーライド解除 (deployment_mode のデフォルトに戻す)
 *   node scripts/heartbeat-rollout.mjs --clear --ids=u1,u2 --apply
 *
 *   # 段階展開: まだオーバーライド未設定の店舗を N 件だけ切替
 *   node scripts/heartbeat-rollout.mjs --set-to=21600 --only-unset --limit=100 --apply
 *
 * セーフティ:
 *   - --apply なしは dry-run (デフォルト)
 *   - --set-to の値域: 30 〜 86400 秒
 *   - --limit が --apply 時の安全装置
 */
import { createClient } from '@supabase/supabase-js'
import process from 'process'

const args = process.argv.slice(2)
const opts = {
  apply:      false,
  status:     false,
  clear:      false,
  setTo:      null,        // 秒
  area:       null,
  vendor:     null,
  ids:        null,
  limit:      null,
  onlyUnset:  false,
}
for (const a of args) {
  if (a === '--apply') opts.apply = true
  else if (a === '--status') opts.status = true
  else if (a === '--clear') opts.clear = true
  else if (a === '--only-unset') opts.onlyUnset = true
  else if (a.startsWith('--set-to=')) opts.setTo = parseInt(a.slice(9), 10)
  else if (a.startsWith('--area='))   opts.area = a.slice(7)
  else if (a.startsWith('--vendor=')) opts.vendor = a.slice(9)
  else if (a.startsWith('--ids='))    opts.ids = a.slice(6).split(',').map((s) => s.trim()).filter(Boolean)
  else if (a.startsWith('--limit='))  opts.limit = parseInt(a.slice(8), 10)
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
}

function printHelp() {
  console.log(`
ハートビート間隔 段階ロールアウト CLI

Modes:
  --status                現状サマリ表示
  --set-to=<sec>          全マッチ店舗のオーバーライドを <sec> に設定 (30〜86400)
  --clear                 オーバーライド解除 (deployment_mode 由来に戻す)

Filters:
  --area=<code>           area_code で絞る
  --vendor=<vendor>       nvr_vendor で絞る
  --ids=<u1,u2,...>       store.id 指定
  --limit=<n>             最大 N 件
  --only-unset            まだ override 未設定の店舗のみ

Safety:
  --apply                 実 UPDATE (省略時は dry-run)
`)
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function showStatus() {
  console.log('\n── ハートビート間隔 分布 ──────────────────────────────────────\n')
  try {
    const { data, error } = await supa.from('v_heartbeat_rollout_status').select('*')
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) {
      console.log('  店舗データなし、または VIEW 未作成 (20260605_004_heartbeat_override.sql を適用してください)\n')
      return
    }
    console.log(`  ${'MODE'.padEnd(22)}${'INTERVAL'.padEnd(12)}${'OVERRIDE'.padEnd(12)}STORES`)
    console.log(`  ${'-'.repeat(70)}`)
    for (const r of rows) {
      const interval = r.effective_interval_sec >= 3600
        ? `${(r.effective_interval_sec / 3600).toFixed(1)}h`
        : `${r.effective_interval_sec}s`
      const flag = r.has_override ? 'yes' : 'no'
      console.log(`  ${r.deployment_mode.padEnd(22)}${interval.padEnd(12)}${flag.padEnd(12)}${r.store_count}`)
    }
    console.log()
  } catch (err) {
    console.error(`status エラー: ${err.message}\n`)
  }
}

async function fetchTargets() {
  let q = supa
    .from('stores')
    .select('id, name, area_code, deployment_mode, nvr_vendor, heartbeat_override_sec')
    .order('name')
  if (opts.area)   q = q.eq('area_code', opts.area)
  if (opts.vendor) q = q.eq('nvr_vendor', opts.vendor)
  if (opts.ids?.length) q = q.in('id', opts.ids)
  if (opts.onlyUnset)   q = q.is('heartbeat_override_sec', null)
  if (opts.limit)  q = q.limit(opts.limit)
  const { data, error } = await q
  if (error) { console.error(error); process.exit(1) }
  return data ?? []
}

async function applyChanges() {
  // バリデーション
  if (opts.setTo !== null) {
    if (Number.isNaN(opts.setTo) || opts.setTo < 30 || opts.setTo > 86400) {
      console.error('ERROR: --set-to は 30 〜 86400 秒の範囲で指定してください')
      process.exit(1)
    }
  }
  if (!opts.clear && opts.setTo === null) {
    console.error('ERROR: --set-to=<sec> または --clear を指定してください')
    process.exit(1)
  }

  const targets = await fetchTargets()
  if (targets.length === 0) {
    console.log('対象 0 件\n')
    return
  }

  const action = opts.clear ? 'CLEAR' : `SET-TO ${opts.setTo}s`
  console.log(`\n${opts.apply ? 'APPLY' : 'DRY-RUN'}: ${action} (${targets.length} 件)\n`)
  console.log(`  ${'ID'.padEnd(9)}${'AREA'.padEnd(9)}${'MODE'.padEnd(22)}${'CURRENT'.padEnd(10)}NAME`)
  console.log(`  ${'-'.repeat(75)}`)
  for (const t of targets) {
    const cur = t.heartbeat_override_sec === null ? '—' : `${t.heartbeat_override_sec}s`
    console.log(`  ${t.id.slice(0, 8)} ${(t.area_code ?? '—').padEnd(8)} ${t.deployment_mode.padEnd(22)}${cur.padEnd(10)}${t.name}`)
  }
  console.log()

  if (!opts.apply) {
    console.log('  DRY-RUN: 変更していません。実行は --apply を追加\n')
    return
  }

  const ids = targets.map((t) => t.id)
  const newValue = opts.clear ? null : opts.setTo
  const { count, error } = await supa
    .from('stores')
    .update({ heartbeat_override_sec: newValue }, { count: 'exact' })
    .in('id', ids)
  if (error) {
    console.error(`UPDATE 失敗: ${error.message}`)
    process.exit(1)
  }
  console.log(`✅ ${count} 件のハートビート間隔を更新しました\n`)
}

async function main() {
  if (opts.status) {
    await showStatus()
    return
  }
  await applyChanges()
}

main().catch((err) => { console.error(err); process.exit(1) })
