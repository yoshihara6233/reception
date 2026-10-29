/**
 * ZIP を流しながら作る (無圧縮・STORE) (2026-10-30・自主診断 ASVS 15.2.2)。
 *
 * 以前の BCP の ZIP (/api/bcp/[id]/snapshots.zip) は、画像を**全部同時に**取りに行き、
 * 全部をメモリに置いてから JSZip で 1 つのバッファにしていた。画像の多い拠点では
 * 関数のメモリと時間の上限に近づき、取りに行く本数にも上限が無かった。
 *
 * ここでは 1 件ずつ (先読みは数件だけ) 取り、取れたものから ZIP の形で書き出す。
 * 手元に持つのは「先読みの数 × 1 枚の大きさ」と中央ディレクトリ (名前と位置) だけ。
 *
 * - JPEG は圧縮済みなので STORE (無圧縮)。中身を全部読んでから書くので、CRC と大きさは
 *   見出しに入れられる (データ記述子は使わない＝どの展開ソフトでも開ける)。
 * - 名前は UTF-8 (汎用ビット 11)。日本語の店舗名・カメラ名がそのまま出る。
 * - ZIP64 は使わない。件数 65,535 未満・全体 4 GiB 未満を呼び出し側の上限で守る。
 * - 取れなかった項目は飛ばす (以前の作りと同じ・取れたものだけを渡す)。
 */

export interface ZipEntrySource {
  /** ZIP の中の道 (`店舗/カメラ/ファイル.jpg`) */
  name: string
  /** 中身を取る。取れなければ null か例外 (その項目は飛ばす) */
  load: () => Promise<Uint8Array | null>
}

export interface ZipStreamOptions {
  /** 先に取りに行く数。手元のメモリはおおよそ これ × 1 枚 (既定 4) */
  prefetch?: number
  /** 中身の合計の上限 (バイト)。超える項目からは入れない (既定 1 GiB) */
  maxTotalBytes?: number
  /** 各項目の更新日時 (既定 今)。日本時間で書く */
  modifiedAt?: Date
  /** 項目を飛ばしたときに呼ぶ (記録用) */
  onSkip?: (name: string, reason: 'load_failed' | 'too_large') => void
}

export const ZIP_MAX_ENTRIES = 65_534
const ZIP32_LIMIT = 0xffff_ffff

// ── CRC-32 (IEEE 802.3) ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS の日時 (2 秒刻み)。日本時間の壁時計で書く (展開した人が見る時刻) */
function dosDateTime(d: Date): { time: number; date: number } {
  const j = new Date(d.getTime() + 9 * 3600_000)
  const year = Math.max(1980, j.getUTCFullYear())
  return {
    time: (j.getUTCHours() << 11) | (j.getUTCMinutes() << 5) | Math.floor(j.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((j.getUTCMonth() + 1) << 5) | j.getUTCDate(),
  }
}

const FLAG_UTF8 = 0x0800
const VERSION = 20

interface CentralRecord {
  name: Uint8Array
  crc: number
  size: number
  offset: number
}

function localHeader(name: Uint8Array, crc: number, size: number, dt: { time: number; date: number }): Uint8Array {
  const b = new Uint8Array(30 + name.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x04034b50, true)
  v.setUint16(4, VERSION, true)
  v.setUint16(6, FLAG_UTF8, true)
  v.setUint16(8, 0, true)            // STORE
  v.setUint16(10, dt.time, true)
  v.setUint16(12, dt.date, true)
  v.setUint32(14, crc, true)
  v.setUint32(18, size, true)        // 圧縮後の大きさ
  v.setUint32(22, size, true)        // 元の大きさ
  v.setUint16(26, name.length, true)
  v.setUint16(28, 0, true)           // 拡張欄なし
  b.set(name, 30)
  return b
}

function centralHeader(r: CentralRecord, dt: { time: number; date: number }): Uint8Array {
  const b = new Uint8Array(46 + r.name.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x02014b50, true)
  v.setUint16(4, VERSION, true)      // 作成したバージョン
  v.setUint16(6, VERSION, true)      // 展開に要るバージョン
  v.setUint16(8, FLAG_UTF8, true)
  v.setUint16(10, 0, true)
  v.setUint16(12, dt.time, true)
  v.setUint16(14, dt.date, true)
  v.setUint32(16, r.crc, true)
  v.setUint32(20, r.size, true)
  v.setUint32(24, r.size, true)
  v.setUint16(28, r.name.length, true)
  // 30 拡張欄・32 注釈・34 ディスク番号・36 内部属性・38 外部属性 はすべて 0
  v.setUint32(42, r.offset, true)
  b.set(r.name, 46)
  return b
}

function endOfCentral(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, count, true)
  v.setUint16(10, count, true)
  v.setUint32(12, cdSize, true)
  v.setUint32(16, cdOffset, true)
  return b
}

/** 同じ道が 2 度出たら `_2`・`_3` を拡張子の前に足す (以前は後のものが前を上書きしていた) */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name }
  const dot = name.lastIndexOf('.')
  const slash = name.lastIndexOf('/')
  const [stem, ext] = dot > slash ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let i = 2; ; i++) {
    const n = `${stem}_${i}${ext}`
    if (!used.has(n)) { used.add(n); return n }
  }
}

/**
 * 項目を順に取り、ZIP の形で流す。項目の数が ZIP_MAX_ENTRIES を超えたら例外
 * (呼び出し側で先に断ること)。
 */
export function zipStream(entries: ZipEntrySource[], opts: ZipStreamOptions = {}): ReadableStream<Uint8Array> {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('zip_too_many_entries')
  const prefetch = Math.max(1, opts.prefetch ?? 4)
  const maxTotal = Math.min(opts.maxTotalBytes ?? 1024 ** 3, ZIP32_LIMIT - 1024 * 1024)
  const dt = dosDateTime(opts.modifiedAt ?? new Date())
  const enc = new TextEncoder()

  const central: CentralRecord[] = []
  const used = new Set<string>()
  const inflight = new Map<number, Promise<Uint8Array | null>>()
  let next = 0       // 次に書く項目
  let started = 0    // 取りに行き始めた数
  let offset = 0     // ここまでに書いたバイト数
  let total = 0      // 中身の合計
  let finished = false
  let cancelled = false

  const startLoads = () => {
    while (!cancelled && started < entries.length && started - next < prefetch) {
      const i = started++
      inflight.set(i, entries[i].load().catch(() => null))
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return
      startLoads()
      // 書ける項目が出るまで進める (飛ばした項目では何も出さないので、1 回の pull で続けて回す)
      while (next < entries.length) {
        const i = next
        const data = await inflight.get(i)!
        inflight.delete(i)
        next++
        startLoads()
        if (cancelled) return
        if (!data) { opts.onSkip?.(entries[i].name, 'load_failed'); continue }
        if (total + data.length > maxTotal) { opts.onSkip?.(entries[i].name, 'too_large'); continue }
        const name = enc.encode(uniqueName(entries[i].name, used))
        const crc = crc32(data)
        const head = localHeader(name, crc, data.length, dt)
        central.push({ name, crc, size: data.length, offset })
        controller.enqueue(head)
        controller.enqueue(data)
        offset += head.length + data.length
        total += data.length
        return
      }
      // 終わり: 中央ディレクトリと終端
      const cdOffset = offset
      let cdSize = 0
      for (const r of central) {
        const h = centralHeader(r, dt)
        controller.enqueue(h)
        cdSize += h.length
      }
      controller.enqueue(endOfCentral(central.length, cdSize, cdOffset))
      finished = true
      controller.close()
    },
    cancel() {
      // 受け手が切れた (ダウンロードの取り消し)。先読みの結果は捨てる
      cancelled = true
      inflight.clear()
    },
  })
}
