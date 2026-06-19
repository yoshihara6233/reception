import { describe, it, expect } from 'vitest'
import { readFirstJpeg } from './nvr-live'

/** Buffer 群を流す ReadableStream を作る。 */
function streamOf(chunks: Buffer[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(new Uint8Array(chunks[i++]))
      else ctrl.close()
    },
  })
}

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const jpeg = (payload: number[]) => Buffer.concat([SOI, Buffer.from(payload), EOI])

describe('readFirstJpeg', () => {
  it('multipart ストリームから最初の完全な JPEG(ffd8..ffd9)を取り出す', async () => {
    const part = Buffer.concat([
      Buffer.from('--myboundary\r\nContent-type: image/jpeg\r\nContent-Length: 6\r\n\r\n', 'latin1'),
      jpeg([0x11, 0x22]),
      Buffer.from('\r\n--myboundary\r\n', 'latin1'),
    ])
    let aborted = false
    const buf = await readFirstJpeg(streamOf([part]), () => { aborted = true })
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)
    expect(buf[buf.length - 2]).toBe(0xff); expect(buf[buf.length - 1]).toBe(0xd9)
    expect(aborted).toBe(true)
  })

  it('チャンク分割されていても ffd8..ffd9 を跨いで結合', async () => {
    const full = jpeg([1, 2, 3, 4])
    const mid = Math.floor(full.length / 2)
    const buf = await readFirstJpeg(streamOf([full.subarray(0, mid), full.subarray(mid)]), () => {})
    expect(buf.length).toBe(full.length)
  })

  it('JPEG が来ずに終端したら throw', async () => {
    await expect(readFirstJpeg(streamOf([Buffer.from('no jpeg here')]), () => {})).rejects.toThrow(/before a complete JPEG/)
  })
})
