/**
 * JPEG の寸法読み取りと「使えるフレームか」の判定。
 *
 * ## なぜ寸法まで見るか
 *
 * i-PRO WJ-NU101 は `push.cgi COMP=JPEG` で、JPEG 配信に対応していないカメラに対して
 * **39×37 の小さなプレースホルダ画像**（701 バイト）を HTTP 200 で返す。バイト列としては
 * 完全に正しい JPEG なので、SOI/EOI を見ているだけの実装はこれを正常フレームとして
 * 受け入れてしまい、16分割グリッドに黒いコマが並ぶ。しかも「取得失敗」ではないので
 * ログにも出ない＝現地で原因に辿り着けない。
 *
 * サイズ（バイト数）だけの閾値では不十分（低ビットレートの正常フレームを誤って弾く）。
 * 画素数で判定すれば、プレースホルダだけを確実に落とせる。
 */

export interface JpegSize {
  width:  number
  height: number
}

/** SOF0-SOF15（DHT=C4 / JPG=C8 / DAC=CC を除く）。どれでも寸法の並びは同じ。 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
])

/**
 * JPEG の SOF セグメントから寸法を読む。JPEG でない／SOF が見つからなければ null。
 * 例外は投げない（呼び出し側でストリームの途中バイトを渡されうるため）。
 */
export function readJpegSize(buf: Buffer): JpegSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let off = 2
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue }              // フィルバイト／同期ずれ
    const marker = buf[off + 1]
    if (marker === 0xff) { off++; continue }                // 0xFF の連続はパディング
    // 長さフィールドを持たないマーカ
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null      // EOI/SOS 以降に SOF は無い
    const len = buf.readUInt16BE(off + 2)
    if (len < 2) return null
    if (SOF_MARKERS.has(marker)) {
      if (off + 9 > buf.length) return null
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
    }
    off += 2 + len
  }
  return null
}

/**
 * グリッド1コマとして意味のある最小寸法。NU101 のプレースホルダ(39×37)を確実に落としつつ、
 * 実在する低解像プロファイル(QVGA 320×240 等)は通す。
 */
export const MIN_USABLE_WIDTH  = 160
export const MIN_USABLE_HEIGHT = 120

/**
 * 「見せられるフレーム」でなければ理由つきで throw する。
 * 黙って小さい画像を通すより、取得失敗として扱ってログと UI に出す方が現地で直せる。
 */
export function assertUsableJpeg(buf: Buffer, context: string): void {
  const size = readJpegSize(buf)
  if (!size) throw new Error(`${context}: JPEG として解釈できません (${buf.length} bytes)`)
  if (size.width < MIN_USABLE_WIDTH || size.height < MIN_USABLE_HEIGHT) {
    throw new Error(
      `${context}: 極小フレーム ${size.width}x${size.height} を受信しました` +
      '（機器がプレースホルダ画像を返しています。カメラの配信設定を確認してください）',
    )
  }
}
