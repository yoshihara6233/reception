import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CI が**すべての PR で起動する**ことの検査。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * `pull_request:` に `branches: [main, develop, monitor-prod]` が付いていた
 * ため、**機能ブランチ宛の PR では CI が 1 つも起動しなかった**。
 * 積んだ PR（PR B の base が PR A のブランチ）がまさにこれで、実例として
 * PR #286 はチェック 0 件のまま「緑」に見えていた。
 *
 * 「走って通った」と「そもそも走らなかった」は画面上ほとんど区別が付かない。
 * detect-changes の skip を成功と読んでいた 2026-08-06 の件と**同じ形**で、
 * あのときは ci-passed にガードを足して直した。ここは入口側のガード。
 *
 * ── 何を見るか ──────────────────────────────────────────────────────────
 * `push:` の branches 絞り込みは正しい（機能ブランチへの push まで全部
 * 回すのは無駄で、そこは PR イベントが受け持つ）。**落としてよいのは push だけ。**
 * `pull_request:` の `paths:` 絞り込みも意図どおり（mutation.yml）なので触らない。
 * 誤りは **base による絞り込み**だけ。
 */

const ROOT = join(process.cwd(), '../../.github/workflows')
const WORKFLOWS = ['ci.yml', 'security.yml', 'mutation.yml']

/**
 * `on:` 直下の `pull_request:` ブロックを取り出す。
 * YAML パーサを足さずに済ませる代わりに、**見つからなければ落とす**
 * （読めなかったのを「絞り込みが無い」と読み違えないため）。
 */
function pullRequestBlock(yaml: string): string[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => /^  pull_request:\s*$/.test(l))
  expect(start, '`  pull_request:` の行が見つかりません（インデントか書式が変わっています）')
    .toBeGreaterThanOrEqual(0)

  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    // インデントが浅くなったらブロックの終わり。
    if (!/^ {4}/.test(line)) break
    body.push(line)
  }
  return body
}

describe('CI のトリガ', () => {
  it.each(WORKFLOWS)('%s: pull_request に base の絞り込みが無い', (name) => {
    const body = pullRequestBlock(readFileSync(join(ROOT, name), 'utf8'))
    const branches = body.filter((l) => /^ {4}branches:/.test(l))
    expect(
      branches,
      `${name} の pull_request に branches 絞り込みがあります。`
      + 'これがあると機能ブランチ宛の PR で CI が 1 つも起動せず、'
      + '「チェック 0 件」が緑に見えます。',
    ).toEqual([])
  })

  it('ci.yml: push 側の絞り込みは残っている（PR が受け持つので push は絞ってよい）', () => {
    // 「全部の絞り込みを消した」だけの直し方をしていないことの確認。
    const yaml = readFileSync(join(ROOT, 'ci.yml'), 'utf8')
    expect(yaml).toMatch(/^ {2}push:\n {4}branches: \[.*monitor-prod.*\]$/m)
  })

  it('mutation.yml: paths の絞り込みは残っている（base とは別の話）', () => {
    const body = pullRequestBlock(readFileSync(join(ROOT, 'mutation.yml'), 'utf8'))
    expect(body.filter((l) => /^ {4}paths:/.test(l)), 'paths まで消しています').toHaveLength(1)
  })

  it('ci-passed は全 job を needs に取る（1つ増やして繋ぎ忘れたら落ちる）', () => {
    // 入口（起動する）と出口（結果を集める）の両方が要る。出口が緩いと
    // 2026-08-06 のように「skip を成功と読む」形に戻る。
    const yaml = readFileSync(join(ROOT, 'ci.yml'), 'utf8')
    // `on:` の中にも `  push:` のような同じ形の行があるので、jobs: 以降だけを見る。
    const jobsSection = yaml.slice(yaml.indexOf('\njobs:'))
    expect(jobsSection, 'jobs: が見つかりません').toBeTruthy()
    const jobs = [...jobsSection.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1])
    expect(jobs.length, 'job を 1 つも拾えていません').toBeGreaterThan(3)
    const needs = /^ {4}needs: \[(.+)\]$/m.exec(
      jobsSection.slice(jobsSection.indexOf('\n  ci-passed:')))?.[1].split(',').map((s) => s.trim()) ?? []
    const missing = jobs.filter((j) => j !== 'ci-passed' && !needs.includes(j))
    expect(missing, 'ci-passed の needs に入っていない job があります').toEqual([])
  })
})
