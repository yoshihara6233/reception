import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 入力の検査 (zod) に通らなかった 400 は、必ず記録する (2026-10-30・自主診断 ASVS 16.3.3)。
 *
 * 以前は 60 本の受け口が `if (!parsed.success) return NextResponse.json(…, { status: 400 })`
 * で返すだけで、どこにも残していなかった。いまは共通の部品 `invalidInput`
 * (lib/api/invalid-input.ts) を通し、`[security] {"kind":"input.invalid",…}` を書く。
 *
 * この試験は `X.safeParse(…)` の失敗の分岐が NextResponse.json で 400 を直に返していたら
 * CI を落とす。新しい受け口を足すときも invalidInput を使うこと。
 */

const API = fileURLToPath(new URL('../app/api', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

describe('zod の検査の失敗は invalidInput で返す', () => {
  const offenders: string[] = []
  let checked = 0
  for (const f of walk(API)) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/const (\w+)\s*=\s*[\w.]+\.safeParse\(/g)) {
      const v = m[1]
      // 失敗の分岐: 1 行の `if (!v.success) return …` か、`if (!v.success) {` から閉じ括弧まで
      const branch = new RegExp(`if \\(!${v}\\.success\\)( \\{\\n[\\s\\S]*?\\n\\s*\\}|[^\\n]*)`, 'g')
      branch.lastIndex = m.index!
      const b = branch.exec(src)
      if (!b) continue
      const text = b[0]
      if (/NextResponse\.json\([^\n]*status: 400/.test(text)) {
        offenders.push(`${relative(API, f)} (${v})`)
      }
      if (/invalidInput\(/.test(text)) checked++
    }
  }
  it('NextResponse.json で 400 を直に返す分岐が無い', () => {
    expect(offenders).toEqual([])
  })
  it('棚卸しが空回りしていない (多くの受け口が invalidInput を通る)', () => {
    expect(checked).toBeGreaterThanOrEqual(60)
  })
})
