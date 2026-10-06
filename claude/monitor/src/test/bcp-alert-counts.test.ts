import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGES } from '@/lib/i18n/messages'

/**
 * MONITOR の左のツリーの BCP の件数と、上の「BCP・他」の数が合わない件 (2026-10-06)。
 *
 * 左は「24 時間以内に BCP の発令の対象になった拠点 (終わったものも含む)」、
 * 上は「終わっていない BCP と巡回の異常」を数える。数え方の違いは残し (発注者の判断・案 A)、
 * 名前で区別する。あわせて、左の件数が操作中でない他のテナントの拠点まで数えていたのを直す。
 */
const ROOT = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('MONITOR の BCP の件数', () => {
  it('★左のツリーの件数は、ツリーに出ている拠点の発令だけを数える', () => {
    const src = read('components/AppShell.tsx')
    expect(src).toMatch(/const treeStoreIds = new Set\(groups\.flatMap/)
    expect(src).toMatch(/alertEventRows = \(\(alertRes\.data \?\? \[\]\) as AlertEventRow\[\]\)\s*\n\s*\.filter\(\(e\) => e\.store_id !== null && treeStoreIds\.has\(e\.store_id\)\)/)
  })

  it('★左は「24 時間以内の BCP 対象拠点」・上は「対応中の BCP・他」と名前で区別する', () => {
    expect(read('components/StoreTreeClient.tsx')).toContain('24 時間以内の BCP 対象拠点')
    expect(read('components/StoreTreeClient.tsx')).not.toContain('直近アラート対象拠点')
    expect(MESSAGES.ja.kpi.bcp).toBe('対応中の BCP・他')
  })
})
