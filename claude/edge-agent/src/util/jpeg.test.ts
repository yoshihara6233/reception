import { describe, it, expect } from 'vitest'
import { assertUsableJpeg, readJpegSize } from './jpeg'

/** 指定寸法の SOF0 を持つ最小 JPEG（画像データは不要＝寸法判定のテストなので）。 */
function jpegOf(width: number, height: number, extraSegments: Buffer[] = []): Buffer {
  const sof = Buffer.alloc(11)
  sof[0] = 0xff; sof[1] = 0xc0
  sof.writeUInt16BE(9, 2)      // セグメント長
  sof[4] = 8                   // 精度
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...extraSegments, sof, Buffer.from([0xff, 0xd9])])
}

/** 長さ付きの任意セグメント（APP0 等）。SOF より前に置かれる。 */
function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head[0] = 0xff; head[1] = marker
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}

describe('readJpegSize', () => {
  it('SOF0 から寸法を読む', () => {
    expect(readJpegSize(jpegOf(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('前置セグメント（APP0/COM 等）を読み飛ばす', () => {
    const app0 = segment(0xe0, Buffer.from('JFIF\0\0\0\0\0\0', 'latin1'))
    const com  = segment(0xfe, Buffer.from('i-PRO camera info', 'latin1'))
    expect(readJpegSize(jpegOf(320, 240, [app0, com]))).toEqual({ width: 320, height: 240 })
  })

  it('プログレッシブ(SOF2)でも読める', () => {
    const j = jpegOf(640, 480)
    j[j.indexOf(0xc0, 2)] = 0xc2      // SOF0 → SOF2
    expect(readJpegSize(j)).toEqual({ width: 640, height: 480 })
  })

  it('JPEG でなければ null', () => {
    expect(readJpegSize(Buffer.from('not a jpeg'))).toBeNull()
    expect(readJpegSize(Buffer.alloc(0))).toBeNull()
  })

  it('SOF が来る前に切れていれば null（途中バイトを渡されても投げない）', () => {
    const j = jpegOf(1920, 1080)
    expect(readJpegSize(j.subarray(0, 4))).toBeNull()
  })
})

describe('assertUsableJpeg', () => {
  it('通常サイズは通る', () => {
    expect(() => assertUsableJpeg(jpegOf(1920, 1080), 'test')).not.toThrow()
    expect(() => assertUsableJpeg(jpegOf(320, 240), 'test')).not.toThrow()
  })

  it('★NU101 のプレースホルダ(39x37)は弾く', () => {
    expect(() => assertUsableJpeg(jpegOf(39, 37), 'grid(pos=0)')).toThrow(/39x37/)
  })

  it('JPEG として読めないものも弾く', () => {
    expect(() => assertUsableJpeg(Buffer.from('junk'), 'test')).toThrow(/JPEG として解釈できません/)
  })

  it('エラーメッセージに呼び出し元を含む（現地でどのセルか分かる）', () => {
    expect(() => assertUsableJpeg(jpegOf(39, 37), 'grid(pos=5)')).toThrow(/grid\(pos=5\)/)
  })
})
