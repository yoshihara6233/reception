#!/usr/bin/env bun
/**
 * 依存脆弱性のゲート。`bun audit` の結果を受容リストと突き合わせて CI を落とす。
 *
 * ── なぜ要るか（2026-08-14 の検査で判明）────────────────────────────────
 * 元は `bun audit || true` で、**何件あってもジョブは緑**だった。
 * 「HIGH は目視で確認する」運用の前提だったが、実際には読まれず
 * **26 件（high 17）が溜まり、その中の Next.js の勧告 9 件が約2か月放置**された。
 * 緑のチェックが「依存に問題なし」と区別できない状態そのものが問題だった。
 *
 * ── 3つの落とし方 ──────────────────────────────────────────────────────
 *   ① 受容していない high/critical がある      → 新しい脆弱性の検知
 *   ② until を過ぎた受容が残っている            → **放置の検知**
 *   ③ どの勧告にも当たらない受容が残っている    → **直ったのに書き残しの検知**
 *
 * ③を入れているのは、受容リストが古びて「実は直っているのに永久に除外され続ける」
 * のを防ぐため。除外リストは黙って腐る。腐ったら落とす。
 *
 * moderate 以下は落とさず一覧だけ出す（読まれないノイズを増やさないため）。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXCEPTIONS_PATH = join(HERE, '..', 'security-exceptions.json')
const BLOCKING = new Set(['high', 'critical'])

/** `bun audit --json` を実行して {package: [advisory,...]} を返す。 */
async function runAudit() {
  const proc = Bun.spawn(['bun', 'audit', '--json'], {
    cwd: join(HERE, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited          // 脆弱性があると非ゼロで終わる。ここでは終了コードを見ない
  if (!out.trim()) return {}  // 0 件のとき bun は空を返す
  try {
    return JSON.parse(out)
  } catch {
    console.error('bun audit の出力を JSON として解釈できませんでした:')
    console.error(out.slice(0, 500))
    process.exit(2)
  }
}

/** GHSA-ID を勧告から取り出す（url の末尾）。 */
function ghsaOf(adv) {
  const m = /(GHSA-[a-z0-9-]+)/i.exec(adv.url ?? '')
  return m ? m[1] : null
}

const raw = await runAudit()
const exceptions = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8')).exceptions ?? []
const today = new Date().toISOString().slice(0, 10)

/** 検出された勧告を GHSA 単位にまとめる（同一勧告が依存経路の数だけ出るため）。 */
const found = new Map()   // ghsa -> { pkg, severity, title }
for (const [pkg, items] of Object.entries(raw)) {
  for (const adv of Array.isArray(items) ? items : [items]) {
    const id = ghsaOf(adv)
    if (!id) continue
    if (!found.has(id)) found.set(id, { pkg, severity: adv.severity, title: adv.title ?? '' })
  }
}

const blocking = [...found].filter(([, a]) => BLOCKING.has(a.severity))
const excepted = new Map(exceptions.map((e) => [e.ghsa, e]))

// ① 受容していない high/critical
const uncovered = blocking.filter(([id]) => !excepted.has(id))
// ② 期限切れの受容（当たっているものだけを対象にする。当たっていないものは③で拾う）
const expired = exceptions.filter((e) => found.has(e.ghsa) && e.until < today)
// ③ どの勧告にも当たらない受容
const stale = exceptions.filter((e) => !found.has(e.ghsa))

const line = (id, a) => `  [${a.severity}] ${a.pkg.padEnd(18)} ${id}  ${a.title.slice(0, 70)}`

console.log(`検出: ${found.size} 件（うち high/critical ${blocking.length} 件）／受容: ${exceptions.length} 件`)

if (uncovered.length) {
  console.log('\n★ 受容されていない high/critical:')
  for (const [id, a] of uncovered) console.log(line(id, a))
  console.log('\n  対応するか、.github/security-exceptions.json に理由と until を書いてください。')
}
if (expired.length) {
  console.log('\n★ 受容の期限切れ（放置されています）:')
  for (const e of expired) console.log(`  ${e.package.padEnd(18)} ${e.ghsa}  until=${e.until}`)
  console.log('\n  直すか、見直したうえで until を延ばしてください。延ばすときは理由も更新すること。')
}
if (stale.length) {
  console.log('\n★ もう当たっていない受容（削除してください）:')
  for (const e of stale) console.log(`  ${e.package.padEnd(18)} ${e.ghsa}  until=${e.until}`)
  console.log('\n  直っているのに除外が残ると、次に同じ勧告が出ても黙って通ります。')
}

const info = [...found].filter(([, a]) => !BLOCKING.has(a.severity))
if (info.length) {
  console.log('\n（参考）moderate 以下 — ゲートでは落としません:')
  for (const [id, a] of info) console.log(line(id, a))
}

const failed = uncovered.length + expired.length + stale.length
if (failed) {
  console.log(`\n失敗: ${failed} 件の要対応があります。`)
  process.exit(1)
}
console.log('\nOK: 未受容の high/critical・期限切れ・古い受容はありません。')
