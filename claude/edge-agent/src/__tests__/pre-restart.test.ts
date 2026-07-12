import { describe, it, expect, beforeEach } from 'vitest'
import { onPreRestart, runPreRestart, resetPreRestart } from '../ota/pre-restart.js'

describe('pre-restart cleanup registry', () => {
  beforeEach(() => resetPreRestart())

  it('登録なしなら即 return', async () => {
    await expect(runPreRestart(100)).resolves.toBeUndefined()
  })

  it('登録済みクリーンアップを全部実行する', async () => {
    const ran: string[] = []
    onPreRestart(async () => { ran.push('a') })
    onPreRestart(async () => { ran.push('b') })
    await runPreRestart(1_000)
    expect(ran.sort()).toEqual(['a', 'b'])
  })

  it('クリーンアップの失敗は握りつぶす（exit を止めない）', async () => {
    const ran: string[] = []
    onPreRestart(async () => { throw new Error('boom') })
    onPreRestart(async () => { ran.push('ok') })
    await expect(runPreRestart(1_000)).resolves.toBeUndefined()
    expect(ran).toEqual(['ok'])
  })

  it('ハングするクリーンアップは timeout で打ち切る', async () => {
    onPreRestart(() => new Promise<void>(() => { /* 永遠に解決しない */ }))
    const start = Date.now()
    await runPreRestart(200)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(150)
    expect(elapsed).toBeLessThan(2_000)
  })
})
