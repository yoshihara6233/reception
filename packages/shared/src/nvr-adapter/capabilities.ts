/**
 * Capability の共通値とヘルパー (packages/shared 版・正本)
 */
import type { NvrCapabilities } from './types'

/**
 * 最も保守的な capability。snapshot + RTSP のみ可、その他全て false。
 * 未知 FW や接続失敗時はこれを返して安全側に倒す (UI で機能が出ない)。
 */
export const CONSERVATIVE_CAPABILITIES: NvrCapabilities = {
  protocol:                 ['rtsp_only'],
  authMethod:               'digest',
  supportsSnapshot:         true,
  supportsLiveRtsp:         true,
  supportsLiveJpegPull:     false,
  supportsVod:              false,
  vodFormats:               [],
  maxVodHours:              0,
  supportsEventPush:        false,
  supportsOnvifPullPoint:   false,
  eventTypes:               [],
  supportsAiMetadata:       false,
  supportsActiveGuard:      false,
  supportsAiOnIpro:         false,
  maxResolution:            '720p',
  maxChannels:              4,
  supportedCodecs:          ['h264'],
  supportsTimelineSnapshot: false,
  supportsMotionZone:       false,
  supportsPtz:              false,
  maxConcurrentSessions:    2,
  rateLimitMs:              1000,
}

export function mergeCapabilities(
  base: NvrCapabilities,
  patch: Partial<NvrCapabilities>,
): NvrCapabilities {
  return { ...base, ...patch }
}
