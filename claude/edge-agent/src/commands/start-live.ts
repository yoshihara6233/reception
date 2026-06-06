/**
 * F46.14: start_live コマンド (adapter 経由)
 *
 * 指定 (店舗, チャンネル) のライブ RTSP URI を取得し、上位が WHIP に流す。
 * adapter.getLiveRtspUri がベンダー差を隠蔽。
 */
import type { CommandContext, CommandResult } from './types'
import { UnsupportedOperationError } from '../adapters/_base'

export interface StartLiveInput {
  channel: number
  stream?: 'main' | 'sub'
}

export interface StartLiveOutput {
  channel:  number
  rtspUri:  string         // 認証情報込み、ログ時は redact
  vendor:   string
  stream:   'main' | 'sub'
}

export async function handleStartLive(
  ctx:   CommandContext,
  input: StartLiveInput,
): Promise<CommandResult<StartLiveOutput>> {
  const { adapter, commandId } = ctx
  const startedAt = Date.now()
  const stream = input.stream ?? 'main'

  if (!adapter.capabilities.supportsLiveRtsp) {
    throw new UnsupportedOperationError(adapter.vendor, 'live RTSP')
  }

  try {
    const rtspUri = await adapter.getLiveRtspUri(input.channel, stream)
    return {
      ok: true,
      data: { channel: input.channel, rtspUri, vendor: adapter.vendor, stream },
      metadata: {
        commandId,
        durationMs: Date.now() - startedAt,
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
