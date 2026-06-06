/**
 * F46.14: capture_snapshot コマンド (adapter 経由)
 *
 * pending_commands.command = 'capture_snapshot' を受けて、指定店舗・チャンネルの
 * 最新スナップショットを取得する。ベンダー非依存 — adapter が抽象化。
 */
import type { CommandContext, CommandResult } from './types'
import { UnsupportedOperationError } from '../adapters/_base'

export interface CaptureSnapshotInput {
  channel: number
}

export interface CaptureSnapshotOutput {
  channel:     number
  jpegBytes:   number
  vendor:      string
  capturedAt:  string
}

/**
 * スナップショット取得 (adapter.getSnapshot 経由)。
 * 戻り値は JPEG バイト数だけ。実バイナリは別ヘルパーで保存する。
 */
export async function handleCaptureSnapshot(
  ctx:   CommandContext,
  input: CaptureSnapshotInput,
): Promise<CommandResult<{ jpeg: Buffer; output: CaptureSnapshotOutput }>> {
  const { adapter, commandId } = ctx
  const startedAt = Date.now()

  // capability チェック (snapshot は基本どの adapter も対応するが念のため)
  if (!adapter.capabilities.supportsSnapshot) {
    throw new UnsupportedOperationError(adapter.vendor, 'snapshot')
  }

  try {
    const jpeg = await adapter.getSnapshot(input.channel)
    return {
      ok: true,
      data: {
        jpeg,
        output: {
          channel:    input.channel,
          jpegBytes:  jpeg.length,
          vendor:     adapter.vendor,
          capturedAt: new Date().toISOString(),
        },
      },
      metadata: {
        commandId,
        durationMs: Date.now() - startedAt,
        fwVersion:  adapter.firmware.fwVersion,
      },
    }
  } catch (err) {
    return {
      ok:    false,
      error: (err as Error).message,
      metadata: {
        commandId,
        durationMs: Date.now() - startedAt,
        vendor:     adapter.vendor,
      },
    }
  }
}
