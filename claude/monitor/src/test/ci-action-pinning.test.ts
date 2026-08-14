import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GitHub Action が **SHA で固定されている**ことの検査。
 *
 * ── なぜ必要か（2026-08-14 の検査 L-9）─────────────────────────────────
 * タグ（`@v4` 等）は**上流が差し替えられる**。上流のリポジトリやメンテナの
 * アカウントが乗っ取られると、こちらは何も変えていないのに CI で任意の
 * コードが走る。しかも**差分が出ないので気づけない** — 同じ `@v4` のままで
 * 中身だけが変わる。
 *
 * 検査時点では `dorny/paths-filter` だけが SHA 固定で、コメントに
 * 「SHA-pinned: supply-chain」と理由まで書いてあった。**やり方は分かっていて、
 * 他に適用されていなかった**という形（2026-06-23 の是正が部分適用のまま）。
 *
 * ── 被害範囲（過大評価しないための記録）────────────────────────────────
 * この CI は本番シークレットを一切参照せず（`secrets.` の参照ゼロ）、
 * `GITHUB_TOKEN` の既定権限は read。したがって乗っ取られても、できるのは
 * ビルド結果の汚染とログの窃取まで。重大度が LOW なのはそのため。
 *
 * ── 追従コスト ──────────────────────────────────────────────────────────
 * `.github/dependabot.yml` が github-actions を週次で見ているので、SHA 固定でも
 * 更新 PR は自動で来る（コメントの版表記も Dependabot が書き換える）。
 * 「固定すると古くなる」問題は既に手当て済み。
 *
 * ── 何を見るか ──────────────────────────────────────────────────────────
 * `uses:` の参照がすべて 40 桁の SHA であること。ローカル参照（`./`）と
 * 再利用ワークフローは対象外。**固定するだけでは次に書く人が戻せるので、
 * 戻したら落ちる形にしておく。**
 */

const ROOT = join(process.cwd(), '../../.github/workflows')

/** ワークフロー内の `uses:` 参照を (ファイル, 行番号, 参照) で列挙する。 */
function usesRefs(): { file: string; line: number; ref: string }[] {
  const out: { file: string; line: number; ref: string }[] = []
  for (const f of readdirSync(ROOT).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((text, i) => {
      const m = /^\s*-?\s*uses:\s*(\S+)/.exec(text)
      if (m) out.push({ file: f, line: i + 1, ref: m[1] })
    })
  }
  return out
}

describe('GitHub Action の SHA 固定', () => {
  it('検査対象が取れている（0 件を「問題なし」と読まない）', () => {
    // 走査そのものが空振りしていないことを先に確かめる。
    // 「見つからなかった」と「見ていなかった」は出力が同じになるため。
    expect(usesRefs().length, 'ワークフローから uses: を 1 件も拾えていません')
      .toBeGreaterThan(10)
  })

  it('★すべての Action が 40 桁の SHA で固定されている', () => {
    const tagged = usesRefs()
      .filter((u) => !u.ref.startsWith('./'))          // ローカル参照は対象外
      .filter((u) => !/@[0-9a-f]{40}$/.test(u.ref))
      .map((u) => `${u.file}:${u.line} ${u.ref}`)

    expect(
      tagged,
      'タグ参照は上流が差し替え可能です（同じ @v4 のまま中身が変わり、差分にも出ません）。'
      + 'SHA に固定してください。追従は .github/dependabot.yml が週次で行います。',
    ).toEqual([])
  })

  it('SHA の隣に版のコメントがある（人が読める形を保つ）', () => {
    // SHA だけだと、どの版か分からず更新の判断ができない。Dependabot も
    // このコメントを書き換える前提で動く。
    const missing: string[] = []
    for (const f of readdirSync(ROOT).filter((n) => n.endsWith('.yml'))) {
      readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((text, i) => {
        if (/uses:\s*\S+@[0-9a-f]{40}/.test(text) && !text.includes('#')) {
          missing.push(`${f}:${i + 1}`)
        }
      })
    }
    expect(missing, 'SHA 固定の行には `# v1.2.3` のように版を添えてください。').toEqual([])
  })
})
