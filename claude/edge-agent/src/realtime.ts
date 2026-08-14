/**
 * Command polling: read edge_devices.pending_command every POLL_MS.
 * More reliable than Supabase Realtime broadcast for server→edge delivery.
 *
 * Monitor writes { action, ...params, request_id } to pending_command.
 * Agent detects a new request_id, processes the command, then clears it.
 *
 * ── 命令が消える問題（外部レビュー指摘 #6・2026-08-13）─────────────────
 * スロットは**実行より先にクリアする**。これは意図した設計で、`pending_command`
 * は 1 台に 1 枠しかなく、BCP は最大 30 分かかるため、実行の間ずっと押さえると
 * その間ライブ視聴もVODも開始できなくなる（発報直後という、最も見たい時間帯）。
 *
 * 代償として、拾った直後に落ちると**命令はどこにも残らない**。`lastRequestId`
 * はメモリ上なので再起動後の再生も無い。
 *
 * ⚠ **await してもしなくても「撮れたか」は分からない。**レビューでは
 *   「`onCommand()` を待機していない」ことが指摘されたが、証跡の実処理は
 *   さらに内側で detached に起動される（`state-machine.ts` の bcp ワーカ、
 *   `alarm/timeline.ts`）。`onCommand` の Promise はワーカの**起動**で解決するので、
 *   await しても捕まるのはそこまで。
 *
 * ⚠ **ここに busy ガードを足して await する形にしないこと。**
 *   いまは `setInterval` が `poll()` を待たないので、長い命令の最中でも次の命令を
 *   拾える。「取りこぼさないように」と直列化すると、BCP の最中（発報直後という
 *   最も見たい時間帯）にライブもVODも開始できなくなる。
 *   `realtime.test.ts` にその性質を固定してある。
 *
 * 代わりに **受け取ったことを DB に残す**（`edge_command_runs`）。これで
 *   ・行が無い     → 命令がエッジに届いていない
 *   ・行はあるが証跡が無い → 届いたが撮れなかった
 * を切り分けられる。「撮れたか」自体は証跡そのものを見る側（クラウドの
 * 日次点検 `evidence_gaps()`）の仕事。
 */
import { config } from './config.js'
import { logger } from './logger.js'
import { getSupabase } from './supabase.js'
import type { EdgeCommand } from './types.js'

// Command pickup latency dominates the user-perceived live/VOD startup
// time (every start_live / start_vod waits up to POLL_MS for the edge to
// notice). 500ms keeps DB load modest (~120 SELECTs/min/edge) while
// reducing average pickup wait from ~1s to ~250ms.
const POLL_MS = 500

/**
 * 受領を記録する。**記録できなくても命令の実行は止めない**（監視のための
 * 記録であって、実行の前提条件ではない）。失敗は debug に留める。
 */
async function recordClaim(cmd: EdgeCommand): Promise<void> {
  const { error } = await getSupabase()
    .from('edge_command_runs')
    .insert({ request_id: cmd.request_id, edge_id: config.EDGE_ID, action: cmd.action })
  if (error) logger.debug({ err: error.message }, 'command-run: claim not recorded')
}

/**
 * 起動の成否を記録する。
 *
 * ⚠ **`ok: true` は「撮れた」ではない。**証跡の実処理は detached なので、
 *   ここで分かるのはハンドラを起動できたかまで。`ok: false` は起動時点の
 *   失敗（未知のカメラ・設定不備など）を捕まえる。
 *
 * ⚠ **0 行一致はエラーにならない。** 2026-08-14、本番でこの update が全件
 *   無音で空振りしていた（`edge_command_runs` にエッジ用の select ポリシーが
 *   無く、`update ... where` が行を見つけられなかった）。PostgREST は 204 を
 *   返し `error` は null なので、`if (error)` だけでは永久に気づけない。
 *   だから **更新できた行数を確かめる**。記録が壊れていること自体を鳴らす。
 */
async function recordFinish(requestId: string, ok: boolean, err?: unknown): Promise<void> {
  const { data, error } = await getSupabase()
    .from('edge_command_runs')
    .update({
      finished_at: new Date().toISOString(),
      ok,
      error: ok ? null : String((err as Error)?.message ?? err ?? '').slice(0, 500),
    })
    .eq('request_id', requestId)
    .select('request_id')

  if (error) {
    logger.warn({ err: error.message, request_id: requestId }, 'command-run: finish not recorded')
    return
  }
  if (!data?.length) {
    // 受領は insert できたのに決着だけ書けない＝権限・ポリシーの非対称。
    // 実行は続けるが、監視が死んでいることは黙らせない。
    logger.warn(
      { request_id: requestId },
      'command-run: finish matched 0 rows — 受領記録を決着できません（RLS/ポリシー要確認）',
    )
  }
}

export function subscribeCommands(onCommand: (cmd: EdgeCommand) => void | Promise<void>): {
  close: () => Promise<void>
} {
  let lastRequestId: string | null = null
  let stopped = false

  async function poll() {
    try {
      const { data, error } = await getSupabase()
        .from('edge_devices')
        .select('pending_command')
        .eq('id', config.EDGE_ID)
        .single()

      if (error || !data?.pending_command) return

      const cmd = data.pending_command as EdgeCommand
      if (!cmd.request_id || cmd.request_id === lastRequestId) return

      lastRequestId = cmd.request_id
      logger.info({ action: cmd.action, request_id: cmd.request_id }, 'poll: command')

      // 受領を先に残す。ここから先で落ちても「届いてはいた」ことが分かる。
      await recordClaim(cmd)

      // Clear the command so it's not re-processed on next poll
      await getSupabase()
        .from('edge_devices')
        .update({ pending_command: null })
        .eq('id', config.EDGE_ID)

      // 起動の成否だけを、決着したときに書き戻す（`ok` は「撮れた」ではない）。
      void Promise.resolve(onCommand(cmd)).then(
        () => recordFinish(cmd.request_id, true),
        (e) => {
          logger.warn({ err: String(e), action: cmd.action }, 'command: handler failed')
          return recordFinish(cmd.request_id, false, e)
        },
      )
    } catch (e) {
      logger.debug({ err: e }, 'poll: error')
    }
  }

  const timer = setInterval(() => { if (!stopped) poll() }, POLL_MS)
  poll() // immediate first check

  return {
    async close() {
      stopped = true
      clearInterval(timer)
    },
  }
}
