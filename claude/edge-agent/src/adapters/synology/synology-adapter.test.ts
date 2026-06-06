/**
 * F53.D: Synology adapter テスト
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { SynologyAdapter } from './synology-adapter'
import type { DsmClient } from './dsm-client'

function makeConfig(): NvrAdapterConfig {
  return {
    storeId: 'st-1', vendor: 'synology-surveillance',
    endpoint: 'https://nas.local:5001',
    credentials: { username: 'admin', password: 'pw' },
    options: {}, timeoutMs: 5000, retryCount: 0,
  }
}
const FW: FirmwareInfo = {
  vendor: 'synology', modelFamily: 'ds_plus', modelNumber: 'DS423+',
  fwVersion: '7.2.1', fwMajor: 7, fwMinor: 2, fwPatch: 1,
  detectedAt: new Date(), source: 'cgi',
}
const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  protocol: ['cgi'], authMethod: 'token',
  supportsSnapshot: true, supportsLiveRtsp: true,
  maxChannels: 16, maxResolution: '4K', supportedCodecs: ['h264', 'h265'],
}

describe('SynologyAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: login が成功すれば true', async () => {
    const mockClient = {
      login: vi.fn().mockResolvedValue('sid-abc'),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: unknown family なら false', async () => {
    const a = new SynologyAdapter(makeConfig(), { ...FW, modelFamily: 'unknown' }, CAPS)
    expect(await a.testConnection()).toBe(false)
  })

  it('getChannelList: cameras を返す', async () => {
    const mockClient = {
      call: vi.fn().mockResolvedValue({
        cameras: [
          { id: 1, newName: 'Entrance', enabled: true, model: 'IPC-EX-S' },
          { id: 2, name: 'Backroom',    enabled: true, model: 'IPC-EX-S' },
        ],
      }),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    const list = await a.getChannelList()
    expect(list).toEqual([
      { index: 1, name: 'Entrance', enabled: true },
      { index: 2, name: 'Backroom', enabled: true },
    ])
  })

  it('getSnapshot: JPEG Buffer を返す', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const mockClient = {
      call: vi.fn().mockImplementation(async (api: string, method: string) => {
        if (method === 'List') return { cameras: [{ id: 5, newName: 'Cam5', enabled: true, model: '' }] }
        if (method === 'GetSnapshot') return jpeg
        throw new Error('unexpected call: ' + api + '.' + method)
      }),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    const buf = await a.getSnapshot(1)
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)
  })

  it('getSnapshot: 範囲外 channel', async () => {
    const mockClient = {
      call: vi.fn().mockResolvedValue({ cameras: [{ id: 1, name: 'A', enabled: true, model: '' }] }),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    await expect(a.getSnapshot(99)).rejects.toThrow(/out of range/)
  })

  it('getLiveRtspUri: GetLiveViewPath から rtspPath を返す', async () => {
    const mockClient = {
      call: vi.fn().mockImplementation(async (api: string, method: string) => {
        if (method === 'List') return { cameras: [{ id: 7, newName: 'X', enabled: true, model: '' }] }
        if (method === 'GetLiveViewPath') return [{ id: 7, rtspPath: 'rtsp://syno/feed/7' }]
        return {}
      }),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toBe('rtsp://syno/feed/7')
  })

  it('getSnapshot: 非 JPEG なら protocol_error', async () => {
    const mockClient = {
      call: vi.fn().mockImplementation(async (api: string, method: string) => {
        if (method === 'List') return { cameras: [{ id: 1, name: 'A', enabled: true, model: '' }] }
        if (method === 'GetSnapshot') return Buffer.from([0, 0, 0])
        return {}
      }),
    } as unknown as DsmClient
    const a = new SynologyAdapter(makeConfig(), FW, CAPS, mockClient)
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })
})
