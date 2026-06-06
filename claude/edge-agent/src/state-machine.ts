/**
 * Edge state machine: Idle → Grid | Live | VOD.
 *
 * Only one active mode at a time. Switching tears down the previous mode
 * before starting the next. The cloud is informed of the new state via
 * the `heartbeat` row update.
 */
import { logger } from './logger.js'
import { heartbeat } from './upload/storage.js'
import { startGrid } from './modes/grid.js'
import { startLive } from './modes/live.js'
import { startVod  } from './modes/vod.js'
import { runBcpCapture, type BcpCaptureCommand } from './modes/bcp.js'
import type { CameraDescriptor, EdgeState } from './types.js'

interface ActiveMode { stop: () => Promise<void> }

export class StateMachine {
  private state: EdgeState = 'idle'
  private active: ActiveMode | null = null
  /**
   * Monotonic transition counter. Every public transition bumps it and
   * captures the value locally; after each await the transition re-checks
   * that it is still the latest before mutating `active`/`state`. This closes
   * the concurrency hole where a late onEnded→toIdle could clobber a freshly
   * started toVod (or vice-versa) mid-flight. JS is single-threaded but these
   * async methods interleave at await points, so a guard is required.
   */
  private generation = 0

  current(): EdgeState { return this.state }

  /** Tear down whatever mode is active. Caller has already bumped generation. */
  private async stopActive(): Promise<void> {
    if (this.active) {
      const a = this.active
      this.active = null
      await a.stop().catch((e) => logger.error({ err: e }, 'stop failed'))
    }
  }

  async toIdle(): Promise<void> {
    const gen = ++this.generation
    await this.stopActive()
    if (gen !== this.generation) return  // superseded by a newer transition
    this.state = 'idle'
    await heartbeat('idle')
    logger.info('state: idle')
  }

  async toGrid(cameras: CameraDescriptor[]): Promise<void> {
    const gen = ++this.generation
    await this.stopActive()
    if (gen !== this.generation) return
    const handle = await startGrid(cameras)
    if (gen !== this.generation) { await handle.stop().catch(() => {}); return }
    this.active = handle
    this.state  = 'grid'
    await heartbeat('grid')
    logger.info({ ch: cameras.length }, 'state: grid')
  }

  async toLive(p: Parameters<typeof startLive>[0]): Promise<void> {
    const gen = ++this.generation
    await this.stopActive()
    if (gen !== this.generation) return
    const handle = await startLive(p)
    if (gen !== this.generation) { await handle.stop().catch(() => {}); return }
    this.active = handle
    this.state  = 'live'
    await heartbeat('live')
    logger.info({ camera_id: p.camera.id }, 'state: live')
  }

  async toVod(p: Parameters<typeof startVod>[0]): Promise<void> {
    const gen = ++this.generation
    await this.stopActive()
    if (gen !== this.generation) return
    const handle = await startVod(p)
    if (gen !== this.generation) { await handle.stop().catch(() => {}); return }
    this.active = handle
    this.state  = 'vod'
    await heartbeat('vod')
    // F77: VOD is no longer LiveKit-room-keyed; identify the work by clipId
    // (vod_clips row) instead. Old `room` field is gone with WHIP.
    logger.info({ clipId: p.clipId }, 'state: vod')
  }

  // F83 — Concurrent BCP events.
  //
  // 以前は state='bcp' の間、新規 BCP イベントを丸ごとスキップしていた。
  // 複数災害が短時間に重なると後発のイベントが取り逃される問題があった。
  //
  // 新方針:
  //   - BCP は live/grid/vod とは排他のまま (FSM state は 'bcp' を維持)
  //   - 同 state='bcp' 中の新規 BCP は worker として並列実行
  //   - すべての worker が完了したら state='idle' に戻る
  //   - 各 worker は独立した Promise で動き、エラーは互いに分離
  //
  // 安全装置:
  //   - MAX_CONCURRENT_BCP で同時実行数を制限 (PoC は 4)
  //   - 上限超過時は新規 BCP を 'queued' としてキューに入れず即拒否
  //     (BCP は時限処理 = 待たせる意味が薄いため。次のイベントに集中)
  private bcpWorkers       = new Set<Promise<void>>()
  private readonly MAX_BCP = 4

  async toBcp(cmd: BcpCaptureCommand, cameras: CameraDescriptor[]): Promise<void> {
    if (this.state !== 'bcp' && this.state !== 'idle' && this.state !== 'error') {
      // live/grid/vod の最中 → 既存挙動どおり、優先度を BCP に切替えるため state を倒す
      await this.toIdle()
    }
    if (this.bcpWorkers.size >= this.MAX_BCP) {
      logger.warn(
        { eventId: cmd.eventId, active: this.bcpWorkers.size, max: this.MAX_BCP },
        'bcp: concurrency limit reached — skip',
      )
      return
    }
    this.state = 'bcp'
    await heartbeat('bcp')
    logger.info(
      { eventId: cmd.eventId, clips: cmd.clips.length, concurrent: this.bcpWorkers.size + 1 },
      'state: bcp (worker started)',
    )

    const worker = (async () => {
      try {
        await runBcpCapture(cmd, cameras)
      } catch (e) {
        logger.error({ err: (e as Error).message, eventId: cmd.eventId }, 'bcp: worker failed')
      } finally {
        logger.info(
          { eventId: cmd.eventId, remaining: this.bcpWorkers.size - 1 },
          'bcp: worker finished',
        )
      }
    })()

    this.bcpWorkers.add(worker)
    void worker.finally(() => {
      this.bcpWorkers.delete(worker)
      if (this.bcpWorkers.size === 0 && this.state === 'bcp') {
        // 最後の worker が終わったらアイドルに戻る
        this.state = 'idle'
        void heartbeat('idle').catch(() => {})
        logger.info({ eventId: cmd.eventId }, 'bcp: all workers finished, back to idle')
      }
    })
  }

  async toError(reason: string): Promise<void> {
    if (this.active) await this.active.stop().catch(() => {})
    this.active = null
    this.state  = 'error'
    await heartbeat('error')
    logger.error({ reason }, 'state: error')
  }
}
