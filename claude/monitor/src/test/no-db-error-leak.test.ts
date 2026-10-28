import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 受け口が DB の誤りの文をそのまま応答に載せないこと (2026-10-29・自主診断 ASVS 16.5.1)。
 * `NextResponse.json({ ... xxxErr.message ... })` の形を見つけたら落とす。
 * 誤りは lib/api/db-error.ts の dbErrorCode でログに書き、応答には db_error だけを返す。
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return routeFiles(p)
    return name === 'route.ts' ? [p] : []
  })
}

describe('DB の誤りの文を応答に載せない', () => {
  it('src/app/api の route.ts に NextResponse.json({ ... err.message }) が無い', () => {
    const pat = /NextResponse\.json\(\{[^}]*\b[a-zA-Z]*(?:[Ee]rr|error)[a-zA-Z]*\.message\b/
    const hits = routeFiles('src/app/api')
      .flatMap((f) => readFileSync(f, 'utf8').split('\n')
        .map((line, i) => (pat.test(line) ? `${f}:${i + 1}` : null))
        .filter((x): x is string => x !== null))
    expect(hits, '誤りの文を返している受け口です。dbErrorCode を使ってください').toEqual([])
  })
})
