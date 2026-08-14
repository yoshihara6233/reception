import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 命令の受領記録（外部レビュー指摘 #6）。
 *
 * ── ここで固定する性質 ──────────────────────────────────────────────────
 * ① **受領を、スロットのクリアより先に記録する。**
 *    順序が本体。逆だと、クリアした直後に落ちたとき命令がどこにも残らない。
 * ② **`onCommand` を待たない。**
 *    待つとこのループが数十分止まり、BCP の最中にライブ視聴が開始できなくなる
 *    （発報直後という、最も見たい時間帯）。レビューの「await していない」は
 *    現象としては正しいが、**await する形にすると別の障害になる**。
 * ③ 起動の成否は決着したときに書き戻す（`ok` は「撮れた」ではない）。
 * ④ 記録に失敗しても命令は実行する（監視のための記録であって前提条件ではない）。
 */

const h = vi.hoisted(() => ({
  /** DB 操作の発生順。①の検証に使う。 */
  ops: [] as string[],
  pendingCommand: null as Record<string, unknown> | null,
  insertFails: false,
  /** 決着の update が行に当たるか。false で「無音の空振り」を再現する。 */
  finishMatches: true,
  runs: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}))

vi.mock('./config.js', () => ({ config: { EDGE_ID: 'edge-1' } }))
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('./supabase.js', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { pending_command: h.pendingCommand }, error: null }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        h.ops.push('insert:edge_command_runs')
        if (h.insertFails) return { error: { message: 'boom' } }
        h.runs.push(row)
        return { error: null }
      },
      // 実物と同じ形にする: pending_command のクリアは `.eq()` で完了、
      // 決着は `.eq().select()` まで繋いで**当たった行数**を返す。
      update: (row: Record<string, unknown>) => ({
        eq: (_col: string, v: string) => {
          if (table === 'edge_devices') {
            h.ops.push('clear:pending_command')
            return Promise.resolve({ error: null })
          }
          return {
            select: async () => {
              h.ops.push('finish:edge_command_runs')
              h.updates.push(row)
              // 0 行でも error は null。これが本番で無音だった形。
              return { data: h.finishMatches ? [{ request_id: v }] : [], error: null }
            },
          }
        },
      }),
    }),
  }),
}))

import { subscribeCommands } from './realtime.js'
import type { EdgeCommand } from './types.js'

const CMD = { action: 'start_bcp_capture', request_id: 'req-1' } as unknown as EdgeCommand

/** setInterval を使わず、最初の即時 poll だけを走らせて後片付けする。 */
async function runOnce(onCommand: (c: EdgeCommand) => void | Promise<void>) {
  const sub = subscribeCommands(onCommand)
  await vi.waitFor(() => expect(h.ops.length).toBeGreaterThan(0))
  await sub.close()
}

beforeEach(() => {
  h.ops = []
  h.runs = []
  h.updates = []
  h.insertFails = false
  h.finishMatches = true
  h.pendingCommand = { ...CMD }
  vi.clearAllMocks()
})

afterEach(() => { vi.useRealTimers() })

describe('subscribeCommands — 受領の記録', () => {
  it('★受領を、スロットのクリアより先に記録する', async () => {
    await runOnce(() => {})
    // 逆順だと、クリア直後に落ちた命令がどこにも残らない。
    expect(h.ops.indexOf('insert:edge_command_runs'))
      .toBeLessThan(h.ops.indexOf('clear:pending_command'))
  })

  it('受領記録に action と edge_id を残す', async () => {
    await runOnce(() => {})
    expect(h.runs[0]).toMatchObject({
      request_id: 'req-1', edge_id: 'edge-1', action: 'start_bcp_capture',
    })
  })

  it('★長い命令の最中でも、次の命令を拾える', async () => {
    // 守りたいのは「直列化しないこと」。BCP は最大 30 分かかるので、
    // 取りこぼし対策として busy ガード＋await を足すと、その間ライブも VOD も
    // 開始できなくなる（発報直後という、最も見たい時間帯）。
    //
    // 補足: いま `setInterval` は `poll()` を待たないので、`onCommand` を
    // await するだけでは直列化しない。**危ないのは busy ガードとの併用**で、
    // このテストはその形を落とす。
    let resolveFirst: (() => void) | undefined
    const seen: string[] = []
    const sub = subscribeCommands((c) => {
      seen.push(c.request_id)
      if (c.request_id === 'req-1') {
        return new Promise<void>((r) => { resolveFirst = r })   // 長い処理
      }
    })

    await vi.waitFor(() => expect(seen).toContain('req-1'))

    // 1 件目が終わらないうちに 2 件目が来る。
    h.pendingCommand = { action: 'start_live', request_id: 'req-2' }
    await vi.waitFor(() => expect(seen).toContain('req-2'), { timeout: 3000 })

    resolveFirst?.()
    await sub.close()
  })

  it('ハンドラが決着するまで finish を書かない', async () => {
    let resolveHandler: (() => void) | undefined
    const sub = subscribeCommands(() => new Promise<void>((r) => { resolveHandler = r }))

    await vi.waitFor(() => expect(h.ops).toContain('clear:pending_command'))
    expect(h.ops).not.toContain('finish:edge_command_runs')

    resolveHandler?.()
    await vi.waitFor(() => expect(h.ops).toContain('finish:edge_command_runs'))
    await sub.close()
  })

  it('★ハンドラが決着したら成否を書き戻す（成功）', async () => {
    await runOnce(async () => {})
    await vi.waitFor(() => expect(h.updates.length).toBe(1))
    expect(h.updates[0]).toMatchObject({ ok: true, error: null })
    expect(h.updates[0].finished_at).toEqual(expect.any(String))
  })

  it('★ハンドラが落ちたら ok=false と理由を残す', async () => {
    await runOnce(async () => { throw new Error('unknown camera') })
    await vi.waitFor(() => expect(h.updates.length).toBe(1))
    expect(h.updates[0]).toMatchObject({ ok: false })
    expect(String(h.updates[0].error)).toContain('unknown camera')
  })

  it('★決着が 0 行だったら鳴らす（本番で全件無音に空振りしていた形）', async () => {
    // 2026-08-14: edge_command_runs にエッジ用の select ポリシーが無く、
    // `update ... where` が行を見つけられず 0 行一致。**error は null** なので
    // `if (error)` だけ見る実装では永久に気づけなかった。
    // 記録が死んでいることそのものを検知できることを固定する。
    h.finishMatches = false
    const { logger } = await import('./logger.js')
    await runOnce(async () => {})
    await vi.waitFor(() => expect(vi.mocked(logger.warn)).toHaveBeenCalled())
    expect(String(vi.mocked(logger.warn).mock.calls.at(-1)?.[1])).toContain('0 rows')
  })

  it('決着が当たっていれば警告は出さない（誤検知しない）', async () => {
    const { logger } = await import('./logger.js')
    await runOnce(async () => {})
    await vi.waitFor(() => expect(h.updates.length).toBe(1))
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('★記録に失敗しても命令は実行する（監視は実行の前提条件ではない）', async () => {
    h.insertFails = true
    let ran = false
    await runOnce(() => { ran = true })
    expect(ran).toBe(true)
    expect(h.ops).toContain('clear:pending_command')
  })

  it('同じ request_id は二度処理しない', async () => {
    let calls = 0
    const sub = subscribeCommands(() => { calls += 1 })
    await vi.waitFor(() => expect(calls).toBe(1))
    // pending_command は残したまま次の poll を待つ（実際はクリア済みだが、
    // クリアが反映される前に再度読んでも二重実行しないことを見る）。
    await new Promise((r) => setTimeout(r, 60))
    await sub.close()
    expect(calls).toBe(1)
  })

  it('request_id を持たない命令は無視する', async () => {
    h.pendingCommand = { action: 'start_grid' }
    let ran = false
    const sub = subscribeCommands(() => { ran = true })
    await new Promise((r) => setTimeout(r, 30))
    await sub.close()
    expect(ran).toBe(false)
    expect(h.ops).toEqual([])
  })

  it('命令が無ければ何も書かない', async () => {
    h.pendingCommand = null
    const sub = subscribeCommands(() => {})
    await new Promise((r) => setTimeout(r, 30))
    await sub.close()
    expect(h.ops).toEqual([])
  })
})
