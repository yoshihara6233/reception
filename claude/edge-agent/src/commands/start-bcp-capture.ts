/**
 * F46.14: start_bcp_capture コマンド (adapter 経由)
 *
 * BCP イベント発生時に 8 枚タイムラインスナップショットを取得。
 * adapter.getTimelineSnapshots が capability で許可されていれば native 取得、
 * なければ手動オフセット待ちで getSnapshot を 8 回呼ぶフォールバック。
 *
 * 上位 (modes/bcp.ts や中央 runner) はこの関数を呼び、戻り値の JPEG[] を
 * Supabase Storage にアップロード + bcp_clips INSERT する。
 */
import type { CommandContext, CommandResult } from './types'
import { UnsupportedOperationError } from '../adapters/_base'

/** デフォルトの BCP オフセット (分単位) */
export const BCP_DEFAULT_OFFSETS = [-5, 0, 5, 10, 15, 20, 25, 30]

export interface StartBcpCaptureInput {
  channel:         number
  /** T+0 の基準時刻 (= alert_issued_at) */
  referenceAtIso:  string
  /** 取得オフセット (分)。省略時は BCP_DEFAULT_OFFSETS */
  offsetsMinutes?: number[]
}

export interface BcpSnapshot {
  channel:   number
  offsetMin: number
  bytes:     number
  ok:        boolean
  error?:    string
}

export interface StartBcpCaptureOutput {
  vendor:           string
  channel:          number
  referenceAtIso:   string
  totalCount:       number
  successCount:     number
  snapshots:        BcpSnapshot[]
}

/**
 * BCP タイムラインスナップショットを取得。
 *
 * 戻り値の `jpegs` は offsetsMinutes と同じ順序 / 同じ長さ。失敗箇所は空 Buffer。
 */
export async function handleStartBcpCapture(
  ctx:   CommandContext,
  input: StartBcpCaptureInput,
): Promise<CommandResult<{ jpegs: Buffer[]; output: StartBcpCaptureOutput }>> {
  const { adapter, commandId } = ctx
  const startedAt = Date.now()
  const offsets = input.offsetsMinutes ?? BCP_DEFAULT_OFFSETS
  const referenceAt = new Date(input.referenceAtIso)

  if (!adapter.capabilities.supportsSnapshot) {
    throw new UnsupportedOperationError(adapter.vendor, 'snapshot')
  }

  let jpegs: Buffer[]

  if (adapter.capabilities.supportsTimelineSnapshot && adapter.getTimelineSnapshots) {
    // Native 一括取得 (v3+ NX/NU および Frigate)
    jpegs = await adapter.getTimelineSnapshots(input.channel, referenceAt, offsets)
  } else {
    // フォールバック: 手動オフセット待ちで getSnapshot を 8 回呼ぶ
    jpegs = []
    for (const offset of offsets) {
      const targetMs = referenceAt.getTime() + offset * 60_000
      if (offset >= 0) {
        const wait = targetMs - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
      try {
        jpegs.push(await adapter.getSnapshot(input.channel))
      } catch {
        jpegs.push(Buffer.alloc(0))
      }
    }
  }

  // 結果集計
  const snapshots: BcpSnapshot[] = offsets.map((offsetMin, i) => ({
    channel:   input.channel,
    offsetMin,
    bytes:     jpegs[i]?.length ?? 0,
    ok:        (jpegs[i]?.length ?? 0) > 0,
  }))
  const successCount = snapshots.filter((s) => s.ok).length

  return {
    ok: successCount > 0,
    data: {
      jpegs,
      output: {
        vendor:         adapter.vendor,
        channel:        input.channel,
        referenceAtIso: input.referenceAtIso,
        totalCount:     offsets.length,
        successCount,
        snapshots,
      },
    },
    metadata: {
      commandId,
      durationMs: Date.now() - startedAt,
      strategy:   adapter.capabilities.supportsTimelineSnapshot ? 'native' : 'fallback',
    },
  }
}
