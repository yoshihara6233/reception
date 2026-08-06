/**
 * i-PRO NVR `push.cgi COMP=H265|H264` の受信バイト列を、デコード可能な
 * Annex-B エレメンタリストリームに戻す純ロジック。
 *
 * ## なぜ要るか
 *
 * NVR 経由（カメラ網が分離された現場）の 16分割グリッドは当初 `COMP=JPEG` で
 * 取っていたが、**WJ-NU101 は JPEG 配信に対応しないカメラに対して 39×37 の
 * プレースホルダ画像を返す**（真っ黒のコマが出る原因）。カメラ側で JPEG 配信を
 * 有効化して回る運用は 100 店舗規模では現実的でない。
 * → H.265/H.264 をそのまま受けて**エッジでデコード**すれば、カメラの設定に
 *   一切依存せずどの現場でも成立する。
 *
 * ## ワイヤフォーマット（CGI-IF v1.5R1 §2.3.3 / §2.3.4 + 実機実測 2026-08-06）
 *
 * ```
 * --myboundary\r\n
 * Content-type: application/octet-stream\r\n
 * Content-Length: <n>\r\n
 * \r\n
 * <n バイト = RTPパケット1個>\r\n
 * ```
 *
 * **各パートがちょうど RTP パケット1個**。独自フレーミングは無い（ここが最大の
 * 懸念だったが、実機ダンプで標準 RTP と確認できた）。RTP ヘッダの拡張には
 * カメラ番号(0x0004)と時刻(0x0007)が載るが、映像復元には不要なので読み飛ばす。
 * ペイロードタイプ: **98=H.264 / 101=H.265**。
 *
 * ## 設計方針
 *
 * - この層は**副作用なしの純ロジック**（ネットワーク・ffmpeg は nvr-live.ts 側）。
 *   実機ダンプの先頭バイト列をそのままテストに使える形にしてある。
 * - 取り出すのは **直近の完結した IRAP(キーフレーム)ピクチャ1枚 + パラメータセット**
 *   だけ。GOP 全体をデコードすれば映像は新しくなるが、16ch × 2秒間隔でそれをやると
 *   iGPU が持たない。グリッドは 0.5fps なので、鮮度は NVR のキーフレーム間隔
 *   （実測ログ `keyframeIntervalMs` で確認できる）に委ねる方が割に合う。
 */

// ── multipart 分解 ────────────────────────────────────────────────

export interface MultipartPart {
  headers: Record<string, string>
  body: Buffer
}

/** ヘッダ部がこれを超えたら同期が壊れていると判断して捨てる。 */
const MAX_HEADER_BYTES = 2048

/**
 * ストリームバッファから完結した multipart パートを全て取り出し、残り（未完部）を返す。
 *
 * boundary 文字列には依存せず「ヘッダ終端(\r\n\r\n) → Content-Length バイト」で切る。
 * boundary 行はヘッダ塊の先頭に含まれる形で一緒に読み飛ばされる。
 * Content-Length が無いパートは長さを決められないので、そこで打ち切る（呼び出し側は
 * 進まない＝異常として扱える）。
 */
export function extractMultipartParts(buf: Buffer): { parts: MultipartPart[]; rest: Buffer } {
  const parts: MultipartPart[] = []
  let cursor = 0
  for (;;) {
    const headerEnd = buf.indexOf('\r\n\r\n', cursor, 'latin1')
    if (headerEnd < 0) break
    if (headerEnd - cursor > MAX_HEADER_BYTES) break
    const headers = parseHeaders(buf.toString('latin1', cursor, headerEnd))
    const lenRaw = headers['content-length']
    const len = lenRaw === undefined ? NaN : Number(lenRaw)
    if (!Number.isInteger(len) || len < 0) break      // 長さ不明 → これ以上進めない
    const bodyStart = headerEnd + 4
    if (buf.length < bodyStart + len) break           // 本体が未着
    parts.push({ headers, body: buf.subarray(bodyStart, bodyStart + len) })
    cursor = bodyStart + len
  }
  return { parts, rest: buf.subarray(cursor) }
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of block.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue                          // boundary 行など
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return out
}

// ── RTP ──────────────────────────────────────────────────────────

export const PAYLOAD_TYPE_H264 = 98
export const PAYLOAD_TYPE_H265 = 101

export type Codec = 'h264' | 'h265'

/** ペイロードタイプからコーデックを決める（§2.3.3）。未知なら null。 */
export function codecForPayloadType(pt: number): Codec | null {
  if (pt === PAYLOAD_TYPE_H264) return 'h264'
  if (pt === PAYLOAD_TYPE_H265) return 'h265'
  return null
}

export interface RtpPacket {
  payloadType: number
  marker:      boolean
  sequence:    number
  timestamp:   number
  payload:     Buffer
}

/** RTP パケットを解析。壊れている／RTP でないなら null（例外は投げない）。 */
export function parseRtpPacket(buf: Buffer): RtpPacket | null {
  if (buf.length < 12) return null
  const b0 = buf[0]
  if ((b0 >> 6) !== 2) return null                    // version=2 以外は RTP ではない
  const csrcCount = b0 & 0x0f
  let off = 12 + csrcCount * 4
  if (buf.length < off) return null
  if ((b0 & 0x10) !== 0) {                            // X=1: 拡張ヘッダ（カメラ番号・時刻）
    if (buf.length < off + 4) return null
    off += 4 + buf.readUInt16BE(off + 2) * 4          // 長さは32bitワード数
    if (buf.length < off) return null
  }
  let end = buf.length
  if ((b0 & 0x20) !== 0) {                            // P=1: 末尾パディング
    const pad = buf[end - 1]
    if (pad < 1 || pad > end - off) return null
    end -= pad
  }
  if (end <= off) return null
  return {
    payloadType: buf[1] & 0x7f,
    marker:      (buf[1] & 0x80) !== 0,
    sequence:    buf.readUInt16BE(2),
    timestamp:   buf.readUInt32BE(4),
    payload:     buf.subarray(off, end),
  }
}

// ── NAL 再構成（FU 分割の結合・集約パケットの展開） ──────────────

/** NAL ヘッダから種別番号を取る。長さ不足なら -1。 */
export function nalUnitType(nal: Buffer, codec: Codec): number {
  if (codec === 'h265') return nal.length >= 2 ? (nal[0] >> 1) & 0x3f : -1
  return nal.length >= 1 ? nal[0] & 0x1f : -1
}

/** VPS/SPS/PPS か（デコードに必ず要る＝別枠で最新版を保持する対象）。 */
export function isParameterSet(type: number, codec: Codec): boolean {
  return codec === 'h265' ? type >= 32 && type <= 34 : type === 7 || type === 8
}

/** 映像スライス（VCL）か。 */
export function isVcl(type: number, codec: Codec): boolean {
  return codec === 'h265' ? type >= 0 && type <= 31 : type >= 1 && type <= 5
}

/** IRAP（単独でデコードを開始できるキーフレーム）か。 */
export function isKeyframe(type: number, codec: Codec): boolean {
  return codec === 'h265' ? type >= 16 && type <= 23 : type === 5
}

/**
 * このスライスが新しいピクチャの先頭か。
 * h265: slice_segment_header 先頭ビット first_slice_segment_in_pic_flag（NALヘッダ2バイトの直後）。
 * h264: slice_header 先頭の first_mb_in_slice ue(v) が 0＝先頭ビットが 1。
 * 1080p でもスライス分割される機種があるため、AU の切れ目はこれで判定する。
 */
export function startsNewPicture(nal: Buffer, codec: Codec): boolean {
  const headerLen = codec === 'h265' ? 2 : 1
  if (nal.length <= headerLen) return false
  return (nal[headerLen] & 0x80) !== 0
}

/** Annex-B のスタートコードを付ける（ffmpeg に渡す形）。 */
export function toAnnexB(nal: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), nal])
}

/**
 * RTP ペイロードから NAL ユニットを取り出す。FU（分割）は完結時にのみ返すため状態を持つ。
 * 返すのはスタートコードを含まない生の NAL。
 */
export class NalReassembler {
  private readonly codec: Codec
  private fragments: Buffer[] = []

  constructor(codec: Codec) {
    this.codec = codec
  }

  /** パケットロス等で FU の途中が欠けた時に呼ぶ（壊れた NAL を出さない）。 */
  reset(): void {
    this.fragments = []
  }

  push(payload: Buffer): Buffer[] {
    return this.codec === 'h265' ? this.pushH265(payload) : this.pushH264(payload)
  }

  private pushH265(p: Buffer): Buffer[] {
    if (p.length < 3) return []
    const type = (p[0] >> 1) & 0x3f
    if (type === 48) return unpackAggregation(p.subarray(2))          // AP
    if (type !== 49) { this.fragments = []; return [p] }              // 単一 NAL
    // FU: [PayloadHdr(2)][FU header(1)][fragment]
    const fu = p[2]
    const nalType = fu & 0x3f
    if ((fu & 0x80) !== 0) {                                          // S=1: 開始
      // 元の NAL ヘッダを復元する（FU の PayloadHdr は type を 49 に差し替えてある）。
      this.fragments = [Buffer.from([(p[0] & 0x81) | (nalType << 1), p[1]]), p.subarray(3)]
      return []
    }
    if (this.fragments.length === 0) return []                        // 開始を取りこぼした
    this.fragments.push(p.subarray(3))
    if ((fu & 0x40) === 0) return []                                  // E=0: 継続
    const nal = Buffer.concat(this.fragments)
    this.fragments = []
    return [nal]
  }

  private pushH264(p: Buffer): Buffer[] {
    if (p.length < 2) return []
    const type = p[0] & 0x1f
    if (type === 24) return unpackAggregation(p.subarray(1))          // STAP-A
    if (type !== 28) { this.fragments = []; return [p] }              // 単一 NAL
    // FU-A: [FU indicator(1)][FU header(1)][fragment]
    const fu = p[1]
    if ((fu & 0x80) !== 0) {
      this.fragments = [Buffer.from([(p[0] & 0xe0) | (fu & 0x1f)]), p.subarray(2)]
      return []
    }
    if (this.fragments.length === 0) return []
    this.fragments.push(p.subarray(2))
    if ((fu & 0x40) === 0) return []
    const nal = Buffer.concat(this.fragments)
    this.fragments = []
    return [nal]
  }
}

/** [2バイト長][NAL] の繰り返しを展開（H.265 AP / H.264 STAP-A 共通）。 */
function unpackAggregation(body: Buffer): Buffer[] {
  const out: Buffer[] = []
  let off = 0
  while (off + 2 <= body.length) {
    const size = body.readUInt16BE(off)
    off += 2
    if (size === 0 || off + size > body.length) break
    out.push(body.subarray(off, off + size))
    off += size
  }
  return out
}

// ── デコード可能な ES の組み立て ──────────────────────────────────

/** h265 は VPS→SPS→PPS、h264 は SPS→PPS の順で前置する。 */
const PARAM_ORDER: Record<Codec, number[]> = { h265: [32, 33, 34], h264: [7, 8] }

/**
 * NAL を投入し続けると「パラメータセット + 直近の完結したキーフレーム1枚」を
 * いつでも取り出せる状態を保つ。
 *
 * キーフレームは**次のピクチャが始まった時点で完結とみなす**。全スライスが
 * 揃う前に ffmpeg へ渡すと `First slice in a frame missing` になるため。
 */
export class KeyframeAssembler {
  private readonly codec: Codec
  private readonly params = new Map<number, Buffer>()
  private pending: Buffer[] = []
  private collecting = false
  private complete: Buffer[] | null = null
  private completedAt = 0
  private lastCompletedAt = 0
  private intervalMs = 0

  constructor(codec: Codec) {
    this.codec = codec
  }

  push(nal: Buffer, now: number = Date.now()): void {
    const type = nalUnitType(nal, this.codec)
    if (type < 0) return
    if (isParameterSet(type, this.codec)) {
      this.params.set(type, nal)                       // 常に最新で上書き
      return
    }
    if (!isVcl(type, this.codec)) return               // AUD/SEI 等はデコードに不要
    if (startsNewPicture(nal, this.codec)) {
      if (this.collecting) this.finish(now)            // 直前のキーフレームが完結
      if (isKeyframe(type, this.codec)) {
        this.pending = [nal]
        this.collecting = true
      }
      return
    }
    if (this.collecting) this.pending.push(nal)        // 同一ピクチャの後続スライス
  }

  private finish(now: number): void {
    this.complete = this.pending
    this.pending = []
    this.collecting = false
    if (this.lastCompletedAt) this.intervalMs = now - this.lastCompletedAt
    this.lastCompletedAt = now
    this.completedAt = now
  }

  /** 組み立て中のコーデック（ffmpeg の入力フォーマット指定に使う）。 */
  get codecName(): Codec {
    return this.codec
  }

  /** 直近キーフレームの受信時刻（ms）。未取得なら 0。 */
  get keyframeAt(): number {
    return this.completedAt
  }

  /** 実測のキーフレーム間隔（ms）。鮮度の上限＝この値。未計測なら 0。 */
  get keyframeIntervalMs(): number {
    return this.intervalMs
  }

  /** パラメータセットが揃い、キーフレームが1枚以上完結しているか。 */
  get ready(): boolean {
    return this.complete !== null && PARAM_ORDER[this.codec].every((t) => this.params.has(t))
  }

  /** ffmpeg に渡せる Annex-B バイト列。未達なら null。 */
  snapshot(): Buffer | null {
    if (!this.ready) return null
    const nals: Buffer[] = []
    for (const t of PARAM_ORDER[this.codec]) nals.push(this.params.get(t)!)
    nals.push(...this.complete!)
    return Buffer.concat(nals.map(toAnnexB))
  }
}
