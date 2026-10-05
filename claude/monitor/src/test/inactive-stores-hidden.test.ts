import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 無効にした拠点 (stores.is_active = false) を MONITOR の一覧に出さないこと (2026-10-05)。
 *
 * 管理画面で「この拠点を有効にする」を外しても、MONITOR の拠点一覧・左のツリー・地図・
 * 画面下の「◯ / ◯ 拠点オンライン」に出続けていた。is_active を見ていたのは巡回と発報の
 * 設定画面だけだった。
 *
 * 決めた扱い (発注者の判断): **一覧には出さないが、発報やイベントは受け取り続ける**
 * (記録は残る)。拠点の詳細は URL を直接開けば見られる。
 *
 * 拠点の一覧を作るクエリは画面ごとに書かれているので、新しい画面や書き換えで
 * 絞り込みが抜けると、また無効の拠点が出る。ここでは、一覧を作るファイルが
 * is_active で絞っていることをソースで確かめる。
 */
const ROOT = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LISTS: { file: string; what: string }[] = [
  { file: 'app/stores/page.tsx',      what: 'MONITOR の拠点一覧' },
  { file: 'components/AppShell.tsx',  what: '左の拠点ツリー' },
  { file: 'app/map/page.tsx',         what: '地図' },
]

describe('無効にした拠点を一覧に出さない', () => {
  it.each(LISTS)('$what ($file) は is_active で絞っている', ({ file }) => {
    const src = read(file)
    expect(src).toMatch(/from\('stores'\)[\s\S]{0,400}\.eq\('is_active', true\)/)
  })

  it('画面下の拠点数とオンライン数は、有効な拠点だけを数える', () => {
    const src = read('components/StatusBar.tsx')
    expect(src).toMatch(/from\('stores'\)[^\n]*\.eq\('is_active', true\)/)
    expect(src).toMatch(/stores!inner\(is_active\)/)
    expect(src).toMatch(/\.eq\('stores\.is_active', true\)/)
  })

  it('イベントの受け口は is_active で止めない (受け取り続けて記録を残す)', () => {
    const src = read('app/api/edge/events/route.ts')
    expect(src).not.toMatch(/is_active/)
  })
})
