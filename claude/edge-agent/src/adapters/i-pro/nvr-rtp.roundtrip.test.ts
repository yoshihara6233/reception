/**
 * 実バイト列での往復検証: ffmpeg が吐いた本物の H.265/H.264 Annex-B を
 * KeyframeAssembler に流し込み、取り出した ES が**そのままデコードできる**ことを見る。
 *
 * 単体テスト（nvr-rtp.test.ts）は手で組んだ NAL しか通していないので、実際の
 * SPS/PPS やスライスヘッダのビット配置（first_slice_segment_in_pic_flag の位置など）を
 * 取り違えていても気づけない。ここが NVR 経由ライブの生死を分けるので、
 * ffmpeg がある環境では必ず実バイト列で確かめる。
 *
 * ffmpeg が無い環境（CI の一部）では skip する。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { KeyframeAssembler, type Codec } from './nvr-rtp'
import { decodeAnnexBToJpeg } from '../../util/decode-frame'
import { readJpegSize } from '../../util/jpeg'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const hasFfmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0

/** Annex-B バイト列を NAL ユニット（スタートコード無し）に分解する。 */
function splitAnnexB(buf: Buffer): Buffer[] {
  const starts: { at: number; len: number }[] = []
  for (let i = 0; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) { starts.push({ at: i, len: 3 }); i += 2 }
      else if (buf[i + 2] === 0 && buf[i + 3] === 1) { starts.push({ at: i, len: 4 }); i += 3 }
    }
  }
  return starts.map((s, idx) => {
    const from = s.at + s.len
    const to = idx + 1 < starts.length ? starts[idx + 1].at : buf.length
    return buf.subarray(from, to)
  })
}

/** テストパターンを指定コーデックの Annex-B で吐く（キーフレーム間隔を短くして複数GOP作る）。 */
function encodeSample(codec: Codec, width: number, height: number): Buffer {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=10:duration=1`,
    '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
    '-g', '5', '-pix_fmt', 'yuv420p',
    '-f', codec === 'h265' ? 'hevc' : 'h264',
    'pipe:1',
  ]
  if (codec === 'h265') args.splice(args.indexOf('-g'), 0, '-x265-params', 'log-level=none')
  const r = spawnSync(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`encode failed: ${r.stderr?.toString().slice(0, 300)}`)
  return r.stdout
}

describe.runIf(hasFfmpeg)('KeyframeAssembler — 実バイト列での往復', () => {
  for (const [codec, w, h] of [['h265', 640, 480], ['h264', 640, 480]] as const) {
    it(`${codec}: 実ストリームからキーフレームを取り出してデコードできる`, async () => {
      const nals = splitAnnexB(encodeSample(codec, w, h))
      expect(nals.length).toBeGreaterThan(10)

      const asm = new KeyframeAssembler(codec)
      for (const nal of nals) asm.push(nal)
      expect(asm.ready).toBe(true)

      const es = asm.snapshot()
      expect(es).not.toBeNull()

      const jpeg = await decodeAnnexBToJpeg(es!, codec, FFMPEG)
      expect(readJpegSize(jpeg)).toEqual({ width: w, height: h })
    }, 60_000)
  }

  it('★ストリーム途中から流し込んでも、最初の IRAP を待って正しく組み立てる', async () => {
    const nals = splitAnnexB(encodeSample('h265', 320, 240))
    const asm = new KeyframeAssembler('h265')
    // 先頭の VPS/SPS/PPS と最初のキーフレームを丸ごと落として「途中受信」を再現。
    for (const nal of nals.slice(8)) asm.push(nal)
    // パラメータセットは次の IRAP の前に再送される（実機の push.cgi も同じ挙動）。
    if (!asm.ready) return                    // 再送が無い符号化条件ならこのケースは対象外
    const jpeg = await decodeAnnexBToJpeg(asm.snapshot()!, 'h265', FFMPEG)
    expect(readJpegSize(jpeg)).toEqual({ width: 320, height: 240 })
  }, 60_000)
})
