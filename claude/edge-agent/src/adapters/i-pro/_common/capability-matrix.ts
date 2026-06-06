/**
 * F46.17: i-PRO Capability マトリックス純関数
 *
 * FW Ver から capability を導出する pure function。
 * 副作用なし、入力 → 出力の単純マッピング。
 *
 * 暫定値の根拠: docs/tier3/firmware-capability-matrix.md
 * 実機検証で精密化: F46.29 (WJ-NX300K), F46.30 (WJ-NU201K)
 */
import type { FirmwareInfo, NvrCapabilities } from '../../_base'
import { CONSERVATIVE_CAPABILITIES, mergeCapabilities } from '../../_base'

/**
 * FW Info から capability を導出。純関数。
 */
export function deriveCapabilities(fw: FirmwareInfo): NvrCapabilities {
  // 必須情報なし → 最保守 fallback
  if (fw.modelFamily === 'unknown' || fw.fwMajor === 0) {
    return CONSERVATIVE_CAPABILITIES
  }

  // WJ-GXE500 (アナログ→IP 変換) は別系統
  if (fw.modelFamily === 'gxe') {
    return buildGxe500Capabilities()
  }

  // WJ-NX / WJ-NU は同系統 (FW Ver で世代分岐)
  if (fw.modelFamily === 'nx' || fw.modelFamily === 'nu') {
    return buildIpNvrCapabilities(fw)
  }

  // 未知 family
  return CONSERVATIVE_CAPABILITIES
}

// ─── WJ-NX / WJ-NU 共通 IP NVR ───────────────────────────────────────────────

function buildIpNvrCapabilities(fw: FirmwareInfo): NvrCapabilities {
  // ベースライン: 全 i-PRO IP NVR で動く機能
  let caps = mergeCapabilities(CONSERVATIVE_CAPABILITIES, {
    protocol:                 ['cgi', 'onvif'],
    authMethod:               'digest',
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    supportsVod:              true,
    vodFormats:               ['mp4'],
    supportsEventPush:        true,
    supportsOnvifPullPoint:   true,
    supportsPtz:              true,
    supportedCodecs:          ['h264'],
    eventTypes:               ['motion', 'video_loss'],
  })

  // ── 世代別の上乗せ ───────────────────────────────────────────────────────
  if (fw.fwMajor >= 2) {
    // v2.x (2020-2021)
    caps = mergeCapabilities(caps, {
      supportsAiMetadata:    true,
      supportsMotionZone:    true,
      maxResolution:         '4K',
      maxChannels:           32,
      supportedCodecs:       ['h264', 'h265'],
      maxVodHours:           12,
      maxConcurrentSessions: 8,
      rateLimitMs:           250,
      eventTypes:            ['motion', 'video_loss', 'tampering'],
    })
  } else {
    // v1.x (2018-2019)
    caps = mergeCapabilities(caps, {
      maxResolution:         '1080p',
      maxChannels:           16,
      maxVodHours:           6,
      maxConcurrentSessions: 4,
      rateLimitMs:           500,
    })
  }

  if (fw.fwMajor >= 3) {
    // v3.x (2022-2023)
    caps = mergeCapabilities(caps, {
      supportsActiveGuard:      true,
      supportsTimelineSnapshot: true,
      maxVodHours:              24,
      maxConcurrentSessions:    16,
      rateLimitMs:              200,
      eventTypes:               ['motion', 'video_loss', 'tampering', 'ai_person', 'ai_vehicle'],
    })
  }

  if (fw.fwMajor >= 4) {
    // v4.x (2024+)
    caps = mergeCapabilities(caps, {
      supportsAiOnIpro: true,
      rateLimitMs:      100,
    })
  }

  // ── WJ-NU 系の縮退 ───────────────────────────────────────────────────────
  if (fw.modelFamily === 'nu') {
    // NU101K (4ch) / NU201K (8ch) / NU301K (16ch) は model_number で判定
    const chMatch = fw.modelNumber.match(/WJ-NU(\d+)/)
    if (chMatch) {
      const code = chMatch[1]
      const maxCh =
        code.startsWith('1') ? 4 :   // NU101K = 4ch
        code.startsWith('2') ? 8 :   // NU201K = 8ch
        code.startsWith('3') ? 16 :  // NU301K = 16ch
                               8     // default
      caps = mergeCapabilities(caps, {
        maxChannels:           maxCh,
        maxConcurrentSessions: Math.min(caps.maxConcurrentSessions, 4),
      })
    }
  }

  return caps
}

// ─── WJ-GXE500 (アナログ→IP 変換) ────────────────────────────────────────────

function buildGxe500Capabilities(): NvrCapabilities {
  return mergeCapabilities(CONSERVATIVE_CAPABILITIES, {
    protocol:               ['cgi', 'rtsp_only'],
    authMethod:             'digest',
    supportsSnapshot:       true,
    supportsLiveRtsp:       true,
    supportsLiveJpegPull:   true,
    supportsVod:            false,        // 録画機能なし (純粋な変換器)
    supportsEventPush:      false,
    supportsAiMetadata:     false,
    supportedCodecs:        ['h264'],
    maxResolution:          '1080p',
    maxChannels:            4,
    supportsMotionZone:     false,
    supportsPtz:            false,
    maxConcurrentSessions:  2,
    rateLimitMs:            1000,
  })
}
