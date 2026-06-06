/**
 * F46.14: export_vod コマンド (adapter 経由)
 *
 * 指定範囲の VOD MP4 を取得。adapter が capability.supportsVod を持つ場合のみ
 * 動作 (持たない adapter は UnsupportedOperationError)。
 */
import type { CommandContext, CommandResult } from './types'
import { UnsupportedOperationError } from '../adapters/_base'

export interface ExportVodInput {
  channel:    number
  fromIso:    string         // ISO 8601
  toIso:      string
}

export interface ExportVodOutput {
  channel:    number
  vendor:     string
  fromIso:    string
  toIso:      string
  /** ストリームは別ヘルパーが消費。ここではバイト数だけ返す */
  bytes?:     number
}

export async function handleExportVod(
  ctx:   CommandContext,
  input: ExportVodInput,
): Promise<CommandResult<{ stream: NodeJS.ReadableStream; output: ExportVodOutput }>> {
  const { adapter, commandId } = ctx
  const startedAt = Date.now()

  if (!adapter.capabilities.supportsVod || !adapter.getVodMp4) {
    throw new UnsupportedOperationError(adapter.vendor, 'VOD MP4 export')
  }

  // VOD 範囲が capability の上限を超えていないか早期チェック
  const fromMs = new Date(input.fromIso).getTime()
  const toMs   = new Date(input.toIso).getTime()
  const hours  = (toMs - fromMs) / 3_600_000
  if (hours > adapter.capabilities.maxVodHours) {
    return {
      ok: false,
      error: `requested ${hours.toFixed(1)}h exceeds max ${adapter.capabilities.maxVodHours}h`,
    }
  }

  try {
    const stream = await adapter.getVodMp4(input.channel, new Date(fromMs), new Date(toMs))
    return {
      ok: true,
      data: {
        stream,
        output: {
          channel: input.channel,
          vendor:  adapter.vendor,
          fromIso: input.fromIso,
          toIso:   input.toIso,
        },
      },
      metadata: { commandId, durationMs: Date.now() - startedAt },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
