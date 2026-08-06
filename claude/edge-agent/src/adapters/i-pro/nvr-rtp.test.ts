import { describe, it, expect } from 'vitest'
import {
  KeyframeAssembler,
  NalReassembler,
  codecForPayloadType,
  extractMultipartParts,
  isKeyframe,
  isParameterSet,
  nalUnitType,
  parseRtpPacket,
  startsNewPicture,
  toAnnexB,
} from './nvr-rtp'

/** multipart のパートを1つ組む（実機と同じヘッダ順・区切り）。 */
function part(body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--myboundary\r\nContent-type: application/octet-stream\r\nContent-Length: ${body.length}\r\n\r\n`,
      'latin1',
    ),
    body,
    Buffer.from('\r\n', 'latin1'),
  ])
}

/** 拡張なし・CSRCなしの RTP パケットを組む。 */
function rtp(pt: number, payload: Buffer, opts: { seq?: number; marker?: boolean } = {}): Buffer {
  const h = Buffer.alloc(12)
  h[0] = 0x80
  h[1] = (opts.marker ? 0x80 : 0) | pt
  h.writeUInt16BE(opts.seq ?? 1, 2)
  return Buffer.concat([h, payload])
}

describe('extractMultipartParts', () => {
  it('完結したパートを全て取り出し、未着分を rest に残す', () => {
    const a = Buffer.from([1, 2, 3])
    const b = Buffer.from([4, 5])
    const buf = Buffer.concat([part(a), part(b), Buffer.from('--myboundary\r\nContent-len', 'latin1')])
    const { parts, rest } = extractMultipartParts(buf)
    expect(parts.map((p) => p.body)).toEqual([a, b])
    expect(rest.length).toBeGreaterThan(0)
  })

  it('本体が途中までしか届いていなければ、そのパートは取り出さない', () => {
    const full = part(Buffer.from([1, 2, 3, 4, 5]))
    const { parts, rest } = extractMultipartParts(full.subarray(0, full.length - 4))
    expect(parts).toHaveLength(0)
    expect(rest.length).toBeGreaterThan(0)   // 次のチャンクと連結して再挑戦できる
  })

  it('ヘッダに Content-Length が無ければ長さを決められないので進めない', () => {
    const buf = Buffer.from('--myboundary\r\nContent-type: application/octet-stream\r\n\r\nxxxx', 'latin1')
    const { parts } = extractMultipartParts(buf)
    expect(parts).toHaveLength(0)
  })

  it('ヘッダ名の大小は問わない', () => {
    const buf = Buffer.concat([
      Buffer.from('--b\r\nCONTENT-LENGTH: 2\r\n\r\n', 'latin1'),
      Buffer.from([9, 9]),
    ])
    expect(extractMultipartParts(buf).parts[0].body).toEqual(Buffer.from([9, 9]))
  })
})

describe('parseRtpPacket', () => {
  it('基本ヘッダを読む', () => {
    const p = parseRtpPacket(rtp(101, Buffer.from([0xaa]), { seq: 0x1234, marker: true }))
    expect(p).toMatchObject({ payloadType: 101, marker: true, sequence: 0x1234 })
    expect(p!.payload).toEqual(Buffer.from([0xaa]))
  })

  it('★拡張ヘッダ（カメラ番号・時刻）を読み飛ばす', () => {
    // 実機 2026-08-06: 先頭バイト 0x90（X=1）・拡張長 7 ワード = 28 バイト。
    const h = Buffer.alloc(12)
    h[0] = 0x90
    h[1] = 101
    const ext = Buffer.alloc(4 + 28)
    ext.writeUInt16BE(0x0004, 0)
    ext.writeUInt16BE(7, 2)
    const p = parseRtpPacket(Buffer.concat([h, ext, Buffer.from([0x46, 0x01, 0x30])]))
    expect(p!.payload).toEqual(Buffer.from([0x46, 0x01, 0x30]))
  })

  it('CSRC 分を読み飛ばす', () => {
    const h = Buffer.alloc(12)
    h[0] = 0x82          // CC=2
    h[1] = 98
    const p = parseRtpPacket(Buffer.concat([h, Buffer.alloc(8), Buffer.from([0x65])]))
    expect(p!.payload).toEqual(Buffer.from([0x65]))
  })

  it('パディングを取り除く', () => {
    const h = Buffer.alloc(12)
    h[0] = 0xa0          // P=1
    h[1] = 101
    const p = parseRtpPacket(Buffer.concat([h, Buffer.from([0x11, 0x22, 0x00, 0x03])]))
    expect(p!.payload).toEqual(Buffer.from([0x11]))
  })

  it('RTP でない／短すぎるものは null（例外にしない）', () => {
    expect(parseRtpPacket(Buffer.alloc(4))).toBeNull()
    const bad = Buffer.alloc(12); bad[0] = 0x00     // version=0
    expect(parseRtpPacket(bad)).toBeNull()
  })
})

describe('codecForPayloadType', () => {
  it('98=H.264 / 101=H.265、それ以外は null', () => {
    expect(codecForPayloadType(98)).toBe('h264')
    expect(codecForPayloadType(101)).toBe('h265')
    expect(codecForPayloadType(96)).toBeNull()
  })
})

describe('NAL の判定（実機ダンプの先頭バイト列）', () => {
  it('h265: 0x46 0x01 = AUD(35) / 0x44 0x01 = PPS(34) / 0x4e 0x01 = SEI(39)', () => {
    expect(nalUnitType(Buffer.from([0x46, 0x01]), 'h265')).toBe(35)
    expect(nalUnitType(Buffer.from([0x44, 0x01]), 'h265')).toBe(34)
    expect(nalUnitType(Buffer.from([0x4e, 0x01]), 'h265')).toBe(39)
    expect(isParameterSet(34, 'h265')).toBe(true)
    expect(isParameterSet(35, 'h265')).toBe(false)
  })

  it('h265: IRAP は 16..23、h264 のキーフレームは type 5', () => {
    expect(isKeyframe(19, 'h265')).toBe(true)   // IDR_W_RADL
    expect(isKeyframe(1, 'h265')).toBe(false)
    expect(isKeyframe(5, 'h264')).toBe(true)
    expect(isKeyframe(1, 'h264')).toBe(false)
  })

  it('先頭スライス判定（h265 は NAL 2 バイト後・h264 は 1 バイト後の最上位ビット）', () => {
    expect(startsNewPicture(Buffer.from([0x26, 0x01, 0xaf]), 'h265')).toBe(true)
    expect(startsNewPicture(Buffer.from([0x26, 0x01, 0x2f]), 'h265')).toBe(false)
    expect(startsNewPicture(Buffer.from([0x65, 0x88]), 'h264')).toBe(true)
    expect(startsNewPicture(Buffer.from([0x65, 0x08]), 'h264')).toBe(false)
  })
})

describe('NalReassembler', () => {
  it('h265: 単一 NAL はそのまま返す', () => {
    const r = new NalReassembler('h265')
    expect(r.push(Buffer.from([0x44, 0x01, 0xc0]))).toEqual([Buffer.from([0x44, 0x01, 0xc0])])
  })

  it('★h265: FU を結合し、元の NAL ヘッダを復元する', () => {
    const r = new NalReassembler('h265')
    // PayloadHdr=0x62,0x01 (type 49) / FU header: S=1 type=19(IDR)
    expect(r.push(Buffer.from([0x62, 0x01, 0x80 | 19, 0xaa]))).toEqual([])
    expect(r.push(Buffer.from([0x62, 0x01, 19, 0xbb]))).toEqual([])
    const out = r.push(Buffer.from([0x62, 0x01, 0x40 | 19, 0xcc]))
    expect(out).toHaveLength(1)
    expect(nalUnitType(out[0], 'h265')).toBe(19)
    expect(out[0]).toEqual(Buffer.from([19 << 1, 0x01, 0xaa, 0xbb, 0xcc]))
  })

  it('★h265: 開始フラグを取りこぼしたら結合しない（壊れた NAL を出さない）', () => {
    const r = new NalReassembler('h265')
    expect(r.push(Buffer.from([0x62, 0x01, 19, 0xbb]))).toEqual([])
    expect(r.push(Buffer.from([0x62, 0x01, 0x40 | 19, 0xcc]))).toEqual([])
  })

  it('reset で組み立て中の断片を捨てる（欠落検知時）', () => {
    const r = new NalReassembler('h265')
    r.push(Buffer.from([0x62, 0x01, 0x80 | 19, 0xaa]))
    r.reset()
    expect(r.push(Buffer.from([0x62, 0x01, 0x40 | 19, 0xcc]))).toEqual([])
  })

  it('h265: AP（集約）を個別の NAL に展開する', () => {
    const r = new NalReassembler('h265')
    const body = Buffer.concat([
      Buffer.from([0x60, 0x01]),                       // PayloadHdr type=48
      Buffer.from([0x00, 0x02]), Buffer.from([0x40, 0x01]),
      Buffer.from([0x00, 0x03]), Buffer.from([0x44, 0x01, 0xc0]),
    ])
    expect(r.push(body)).toEqual([Buffer.from([0x40, 0x01]), Buffer.from([0x44, 0x01, 0xc0])])
  })

  it('★h264: FU-A を結合して NAL ヘッダを復元する', () => {
    const r = new NalReassembler('h264')
    // FU indicator 0x7c (nri=3,type=28) / FU header S=1 type=5
    expect(r.push(Buffer.from([0x7c, 0x80 | 5, 0xaa]))).toEqual([])
    const out = r.push(Buffer.from([0x7c, 0x40 | 5, 0xbb]))
    expect(out).toEqual([Buffer.from([0x65, 0xaa, 0xbb])])
  })

  it('h264: STAP-A を展開する', () => {
    const r = new NalReassembler('h264')
    const body = Buffer.concat([
      Buffer.from([0x78]),                             // type=24
      Buffer.from([0x00, 0x02]), Buffer.from([0x67, 0x42]),
      Buffer.from([0x00, 0x01]), Buffer.from([0x68]),
    ])
    expect(r.push(body)).toEqual([Buffer.from([0x67, 0x42]), Buffer.from([0x68])])
  })
})

describe('KeyframeAssembler', () => {
  const vps = Buffer.from([0x40, 0x01, 0x0c])
  const sps = Buffer.from([0x42, 0x01, 0x01])
  const pps = Buffer.from([0x44, 0x01, 0xc0])
  const idr = (first: boolean) => Buffer.from([19 << 1, 0x01, first ? 0xaf : 0x2f, 0x99])
  const inter = (first: boolean) => Buffer.from([1 << 1, 0x01, first ? 0xaf : 0x2f, 0x11])

  it('パラメータセットが揃うまで ready にならない', () => {
    const a = new KeyframeAssembler('h265')
    a.push(idr(true)); a.push(inter(true))
    expect(a.ready).toBe(false)
    expect(a.snapshot()).toBeNull()
  })

  it('★キーフレームは「次のピクチャが始まって」から完結扱いにする', () => {
    const a = new KeyframeAssembler('h265')
    a.push(vps); a.push(sps); a.push(pps)
    a.push(idr(true))
    expect(a.ready).toBe(false)                 // まだスライスが続くかもしれない
    a.push(idr(false))                          // 同一ピクチャの2枚目のスライス
    a.push(inter(true))                         // 次のピクチャ = ここで完結
    expect(a.ready).toBe(true)
  })

  it('snapshot は VPS→SPS→PPS→スライス の順で Annex-B を返す', () => {
    const a = new KeyframeAssembler('h265')
    a.push(vps); a.push(sps); a.push(pps)
    a.push(idr(true)); a.push(inter(true))
    expect(a.snapshot()).toEqual(Buffer.concat([vps, sps, pps, idr(true)].map(toAnnexB)))
  })

  it('パラメータセットは最新で上書きされる（途中で解像度が変わっても追従）', () => {
    const a = new KeyframeAssembler('h265')
    a.push(vps); a.push(sps); a.push(pps)
    a.push(idr(true)); a.push(inter(true))
    const sps2 = Buffer.from([0x42, 0x01, 0x02])
    a.push(sps2)
    expect(a.snapshot()!.includes(sps2)).toBe(true)
  })

  it('★非キーフレームからは組み立てを始めない（IRAP 待ち）', () => {
    const a = new KeyframeAssembler('h265')
    a.push(vps); a.push(sps); a.push(pps)
    a.push(inter(true)); a.push(inter(true))
    expect(a.ready).toBe(false)
  })

  it('キーフレーム間隔を実測する（鮮度の上限として監視できる）', () => {
    const a = new KeyframeAssembler('h265')
    a.push(vps, 0); a.push(sps, 0); a.push(pps, 0)
    a.push(idr(true), 0); a.push(inter(true), 1_000)      // 1本目が完結
    a.push(idr(true), 2_000); a.push(inter(true), 3_000)  // 2本目が完結
    expect(a.keyframeIntervalMs).toBe(2_000)
  })

  it('h264 でも同じ流れで組み立てられる', () => {
    const a = new KeyframeAssembler('h264')
    a.push(Buffer.from([0x67, 0x42]))                     // SPS
    a.push(Buffer.from([0x68, 0xce]))                     // PPS
    a.push(Buffer.from([0x65, 0x88, 0x01]))               // IDR 先頭スライス
    a.push(Buffer.from([0x41, 0x88, 0x02]))               // 次のピクチャ
    expect(a.ready).toBe(true)
    expect(a.codecName).toBe('h264')
  })
})
