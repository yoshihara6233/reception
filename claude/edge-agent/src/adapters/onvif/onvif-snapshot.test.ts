import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveOnvifSnapshotUrl, fetchOnvifJpeg } from './onvif-snapshot'
import type { OnvifSoapClient } from './onvif-soap-client'

const opts = { endpoint: 'http://192.168.0.102', username: 'admin', password: '12345' }
afterEach(() => vi.restoreAllMocks())

describe('resolveOnvifSnapshotUrl', () => {
  it('JPEGプロファイルを優先して GetSnapshotUri を返す', async () => {
    const client = {
      getProfiles: vi.fn().mockResolvedValue([
        { token: 'h264', name: 'Main', encoding: 'H264' },
        { token: 'jpeg', name: 'JPEG', encoding: 'JPEG' },
      ]),
      getSnapshotUri: vi.fn().mockResolvedValue('http://192.168.0.102/cgi-bin/camera?resolution=1280'),
    } as unknown as OnvifSoapClient
    const url = await resolveOnvifSnapshotUrl(opts, 1, client)
    expect(url).toBe('http://192.168.0.102/cgi-bin/camera?resolution=1280')
    expect((client.getSnapshotUri as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('jpeg')
  })

  it('Uri が空なら throw', async () => {
    const client = {
      getProfiles: vi.fn().mockResolvedValue([{ token: 'p1', name: 'x', encoding: 'JPEG' }]),
      getSnapshotUri: vi.fn().mockResolvedValue(''),
    } as unknown as OnvifSoapClient
    await expect(resolveOnvifSnapshotUrl(opts, 1, client)).rejects.toThrow(/empty/)
  })
})

describe('fetchOnvifJpeg', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])

  it('Basic で JPEG を取得', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JPEG, { status: 200 }))
    const buf = await fetchOnvifJpeg('http://x/snap', 'admin', 'pw')
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)
  })

  it('401(Digest) → Digest 再試行で JPEG', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="cam", nonce="abc", qop="auth"' } }))
      .mockResolvedValueOnce(new Response(JPEG, { status: 200 }))
    const buf = await fetchOnvifJpeg('http://x/snap', 'admin', 'pw')
    expect(buf[0]).toBe(0xff)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
  })

  it('JPEG でなければ throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([0x00, 0x01]), { status: 200 }))
    await expect(fetchOnvifJpeg('http://x/snap', 'admin', 'pw')).rejects.toThrow(/not JPEG/)
  })
})
