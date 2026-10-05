/**
 * 閉域の拠点の書き出しファイル（gvms-feedback-export/1）を、取り込みの受け口へ分けて送るための分割。
 *
 * 画像（data_base64）を含むと 1 件で 4 MB を超えうる。Vercel の関数の本文の上限は 4.5 MB なので、
 * 1 回の本文がおよそ 3.5 MB を超えないよう items を区切る。1 件だけで超えるもの（画像 3 MiB の
 * base64 ≒ 4.2 MB）は、その 1 件だけで送る（受け口の上限 3 MiB の画像なら 4.5 MB の内側に収まる）。
 */
export const IMPORT_CHUNK_MAX_BYTES = 3_500_000

export interface ImportChunk {
  /** このかたまりの先頭が、元の items の何番目か（受け口の index に足して元の番号に戻す） */
  start: number
  items: unknown[]
}

export function chunkImportItems(items: unknown[], maxBytes = IMPORT_CHUNK_MAX_BYTES): ImportChunk[] {
  const enc = new TextEncoder()
  const out: ImportChunk[] = []
  let cur: ImportChunk | null = null
  let curBytes = 0
  items.forEach((it, i) => {
    const n = enc.encode(JSON.stringify(it) ?? 'null').length + 1
    if (!cur || (curBytes + n > maxBytes && cur.items.length > 0)) {
      cur = { start: i, items: [] }
      out.push(cur)
      curBytes = 0
    }
    cur.items.push(it)
    curBytes += n
  })
  return out
}
