/**
 * F52.C: WJ-GXE500 adapter テスト
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { IProGxe500Adapter } from './gxe-adapter'

function makeConfig(): NvrAdapterConfig {
  return {
    storeId: 'st-1', vendor: 'i-pro-gxe500',
    endpoint: 'http://10.0.1.30',
    credentials: { username: 'admin', password: 'pw' },
    options: {}, timeoutMs: 5000, retryCount: 0,
  }
}

const FW: FirmwareInfo = {
  vendor: 'i-pro', modelFamily: 'gxe', modelNumber: 'WJ-GXE500',
  fwVersion: '1.10-0001', fwMajor: 1, fwMinor: 10, fwPatch: 1,
  detectedAt: new Date(), source: 'cgi',
}

// GXE500 用 capability (snapshot + live のみ)
const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  protocol:             ['cgi', 'rtsp_only'],
  authMethod:           'digest',
  supportsSnapshot:     true,
  supportsLiveRtsp:     true,
  supportsLiveJpegPull: true,
  maxChannels:          4,
  maxResolution:        '1080p',
  supportedCodecs:      ['h264'],
}

describe('IProGxe500Adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('vendor は i-pro-gxe500', () => {
    const a = new IProGxe500Adapter(makeConfig(), FW, CAPS)
    expect(a.vendor).toBe('i-pro-gxe500')
  })

  it('getLiveRtspUri: 4ch まで OK', async () => {
    const a = new IProGxe500Adapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(3, 'main')
    expect(uri).toBe('rtsp://admin:pw@10.0.1.30:554/MediaInput/h264/ch03_main')
  })

  it('getLiveRtspUri: ch=5 はエラー', async () => {
    const a = new IProGxe500Adapter(makeConfig(), FW, CAPS)
    await expect(a.getLiveRtspUri(5)).rejects.toThrow(/channel 5 out of range/)
  })

  it('getVodMp4 は UnsupportedOperationError', async () => {
    const a = new IProGxe500Adapter(makeConfig(), FW, CAPS)
    await expect(a.getVodMp4(1, new Date(), new Date())).rejects.toThrow(/does not support recording/)
  })
})
