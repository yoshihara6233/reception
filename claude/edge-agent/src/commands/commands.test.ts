/**
 * F46.14: commands ハンドラのユニットテスト
 *
 * モック adapter を差し込み、capability 分岐と error 処理を検証。
 */
import { describe, it, expect } from 'vitest'
import type {
  NvrAdapter, NvrCapabilities, FirmwareInfo, NvrVendor,
} from '../adapters/_base'
import { CONSERVATIVE_CAPABILITIES } from '../adapters/_base'
import { handleCaptureSnapshot } from './capture-snapshot'
import { handleStartLive } from './start-live'
import { handleExportVod } from './export-vod'
import { handleStartBcpCapture } from './start-bcp-capture'
import type { CommandContext, StoreNvrConfig } from './types'

// ── モック adapter ファクトリ ────────────────────────────────────────────────

interface MockAdapterOpts {
  vendor?:       NvrVendor
  capabilities?: Partial<NvrCapabilities>
  snapshot?:     () => Promise<Buffer>
  rtspUri?:      string
  vodStream?:    () => NodeJS.ReadableStream
  timeline?:     () => Promise<Buffer[]>
}

function mockAdapter(opts: MockAdapterOpts = {}): NvrAdapter {
  const caps: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsVod:              true,
    maxVodHours:              6,
    supportsTimelineSnapshot: false,
    maxChannels:              16,
    ...(opts.capabilities ?? {}),
  }
  const fw: FirmwareInfo = {
    vendor:      'test',
    modelFamily: 'mock',
    modelNumber: 'MOCK-1',
    fwVersion:   '0.0.0',
    fwMajor:     0,
    fwMinor:     0,
    fwPatch:     0,
    detectedAt:  new Date(),
    source:      'cgi',
  }
  const adapter: NvrAdapter = {
    vendor:       opts.vendor ?? 'frigate',
    capabilities: caps,
    firmware:     fw,
    testConnection: async () => true,
    getChannelList: async () => [],
    getSnapshot: async () => opts.snapshot
      ? opts.snapshot()
      : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    getLiveRtspUri: async () => opts.rtspUri ?? 'rtsp://mock/test',
    dispose: async () => { /* no-op */ },
  }
  if (caps.supportsVod) {
    adapter.getVodMp4 = opts.vodStream
      ? async () => opts.vodStream!()
      : async () => {
          const { Readable } = await import('stream')
          return Readable.from(['mock-mp4'])
        }
  }
  if (caps.supportsTimelineSnapshot) {
    adapter.getTimelineSnapshots = opts.timeline ?? (async () => [
      Buffer.from([0xff, 0xd8, 0x00]),
      Buffer.from([0xff, 0xd8, 0x00]),
    ])
  }
  return adapter
}

function makeCtx(adapter: NvrAdapter): CommandContext {
  const store: StoreNvrConfig = {
    storeId:           'test-1',
    nvrVendor:         adapter.vendor,
    nvrEndpoint:       'http://x',
    nvrCredentialsRef: 'ref-x',
    nvrOptions:        {},
  }
  return { adapter, store, commandId: 'cmd-1' }
}

// ── handleCaptureSnapshot ──────────────────────────────────────────────

describe('handleCaptureSnapshot', () => {
  it('成功: JPEG を返し metadata.vendor をセット', async () => {
    const ctx = makeCtx(mockAdapter())
    const res = await handleCaptureSnapshot(ctx, { channel: 1 })
    expect(res.ok).toBe(true)
    expect(res.data?.jpeg[0]).toBe(0xff)
    expect(res.data?.output.vendor).toBe('frigate')
    expect(res.metadata?.commandId).toBe('cmd-1')
  })

  it('失敗: adapter が throw → ok=false + error', async () => {
    const ctx = makeCtx(mockAdapter({
      snapshot: async () => { throw new Error('camera offline') },
    }))
    const res = await handleCaptureSnapshot(ctx, { channel: 1 })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('camera offline')
  })

  it('capability なし → UnsupportedOperationError', async () => {
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsSnapshot: false },
    }))
    await expect(handleCaptureSnapshot(ctx, { channel: 1 })).rejects.toThrow(/snapshot/)
  })
})

// ── handleStartLive ──────────────────────────────────────────────────

describe('handleStartLive', () => {
  it('成功: rtspUri を返す', async () => {
    const ctx = makeCtx(mockAdapter({ rtspUri: 'rtsp://1.2.3.4/foo' }))
    const res = await handleStartLive(ctx, { channel: 2 })
    expect(res.ok).toBe(true)
    expect(res.data?.rtspUri).toBe('rtsp://1.2.3.4/foo')
    expect(res.data?.stream).toBe('main')
  })

  it('sub stream を指定可能', async () => {
    const ctx = makeCtx(mockAdapter())
    const res = await handleStartLive(ctx, { channel: 2, stream: 'sub' })
    expect(res.data?.stream).toBe('sub')
  })

  it('capability なし → UnsupportedOperationError', async () => {
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsLiveRtsp: false },
    }))
    await expect(handleStartLive(ctx, { channel: 1 })).rejects.toThrow(/RTSP/)
  })
})

// ── handleExportVod ──────────────────────────────────────────────────

describe('handleExportVod', () => {
  it('成功: stream を返す', async () => {
    const ctx = makeCtx(mockAdapter())
    const res = await handleExportVod(ctx, {
      channel: 1,
      fromIso: '2026-06-04T00:00:00Z',
      toIso:   '2026-06-04T01:00:00Z',
    })
    expect(res.ok).toBe(true)
    expect(res.data?.stream).toBeDefined()
  })

  it('範囲が capability の maxVodHours を超えると失敗', async () => {
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsVod: true, maxVodHours: 1 },
    }))
    const res = await handleExportVod(ctx, {
      channel: 1,
      fromIso: '2026-06-04T00:00:00Z',
      toIso:   '2026-06-04T05:00:00Z',  // 5h > 1h
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exceeds max/)
  })

  it('capability なし → UnsupportedOperationError', async () => {
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsVod: false },
    }))
    await expect(handleExportVod(ctx, {
      channel: 1, fromIso: 'a', toIso: 'b',
    })).rejects.toThrow(/VOD/)
  })
})

// ── handleStartBcpCapture ────────────────────────────────────────────

describe('handleStartBcpCapture', () => {
  it('native timeline 対応: 8 枚返す', async () => {
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsTimelineSnapshot: true },
      timeline:    async () => Array(8).fill(Buffer.from([0xff, 0xd8, 0x00])),
    }))
    const res = await handleStartBcpCapture(ctx, {
      channel: 1,
      referenceAtIso: new Date().toISOString(),
      offsetsMinutes: [-5, 0, 5, 10, 15, 20, 25, 30],
    })
    expect(res.ok).toBe(true)
    expect(res.data?.jpegs).toHaveLength(8)
    expect(res.data?.output.successCount).toBe(8)
    expect(res.metadata?.strategy).toBe('native')
  })

  it('フォールバック: getSnapshot を offsets 回呼ぶ', async () => {
    let calls = 0
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsTimelineSnapshot: false },
      snapshot: async () => {
        calls++
        return Buffer.from([0xff, 0xd8, 0x00])
      },
    }))
    // 過去オフセットのみで wait 不要なケース
    const res = await handleStartBcpCapture(ctx, {
      channel: 1,
      referenceAtIso: new Date(Date.now() - 60 * 60_000).toISOString(),
      offsetsMinutes: [-5, 0, 5],
    })
    expect(res.ok).toBe(true)
    expect(calls).toBe(3)
    expect(res.metadata?.strategy).toBe('fallback')
  })

  it('一部失敗でも successCount > 0 なら ok=true', async () => {
    let calls = 0
    const ctx = makeCtx(mockAdapter({
      capabilities: { supportsTimelineSnapshot: false },
      snapshot: async () => {
        calls++
        if (calls === 2) throw new Error('flaky')
        return Buffer.from([0xff, 0xd8, 0x00])
      },
    }))
    const res = await handleStartBcpCapture(ctx, {
      channel: 1,
      referenceAtIso: new Date(Date.now() - 60 * 60_000).toISOString(),
      offsetsMinutes: [-10, -5, 0],
    })
    expect(res.ok).toBe(true)
    expect(res.data?.output.successCount).toBe(2)
    expect(res.data?.output.totalCount).toBe(3)
  })
})
