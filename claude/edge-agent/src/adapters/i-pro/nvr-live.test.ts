import { describe, it, expect } from 'vitest'
import { extractJpegFrames } from './nvr-live'

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const jpeg = (payload: number[]) => Buffer.concat([SOI, Buffer.from(payload), EOI])

describe('extractJpegFrames', () => {
  it('完全な JPEG を全て取り出し、末尾の未完部を rest に残す', () => {
    const a = jpeg([1, 2])
    const b = jpeg([3, 4, 5])
    const partial = Buffer.concat([SOI, Buffer.from([9, 9])])  // EOI 未着
    const buf = Buffer.concat([
      Buffer.from('--myboundary\r\nContent-type: image/jpeg\r\n\r\n', 'latin1'), a,
      Buffer.from('\r\n--myboundary\r\nContent-type: image/jpeg\r\n\r\n', 'latin1'), b,
      Buffer.from('\r\n--myboundary\r\n', 'latin1'), partial,
    ])
    const { frames, rest } = extractJpegFrames(buf)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual(a)
    expect(frames[1]).toEqual(b)
    // rest は最後の SOI 以降（未完フレーム）を含む
    expect(rest.indexOf(SOI)).toBe(0)
  })

  it('完全フレームが無ければ frames 空・rest は SOI 以降', () => {
    const buf = Buffer.concat([Buffer.from('junk'), SOI, Buffer.from([1, 2])])
    const { frames, rest } = extractJpegFrames(buf)
    expect(frames).toHaveLength(0)
    expect(rest[0]).toBe(0xff); expect(rest[1]).toBe(0xd8)
  })

  it('SOI も無ければ rest は空（全消費）', () => {
    const { frames, rest } = extractJpegFrames(Buffer.from('no markers here'))
    expect(frames).toHaveLength(0)
    expect(rest.length).toBe(0)
  })

  it('1フレームちょうどは rest 空', () => {
    const { frames, rest } = extractJpegFrames(jpeg([7, 7, 7]))
    expect(frames).toHaveLength(1)
    expect(rest.length).toBe(0)
  })
})
