/**
 * Minimal RFC-4180-ish CSV parser. Good enough for admin uploads of up to
 * ~10k rows; for larger imports run a Supabase Edge Function and stream.
 *
 * - Handles double-quoted fields and embedded commas / newlines
 * - First row is the header
 * - Returns rows as objects keyed by header
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [[]]
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inQuote) {
      if (c === '"' && n === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { rows[rows.length - 1].push(cur); cur = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { rows[rows.length - 1].push(cur); cur = ''; rows.push([]) }
      else { cur += c }
    }
  }
  if (cur.length || rows[rows.length - 1].length) rows[rows.length - 1].push(cur)

  // Drop empty trailing rows
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
  if (!rows.length) return []

  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
    return obj
  })
}

/**
 * 1 回の取り込みの行数の上限 (2026-10-30・自主診断 ASVS 15.2.2)。
 *
 * 以前は行数の上限が無く、本文の 4.5 MB (Vercel の上限) だけが頭打ちだった。
 * - 拠点: 行ごとに名前の重複・契約の上限を確かめて 1 行ずつ書く (1 行 数十ミリ秒)。
 *   1,000 行なら関数の上限 (300 秒) に十分収まる。
 * - カメラ: 検査のあと 1 回の upsert にまとめる。5,000 行 (拠点 300 × 16 台) まで。
 * 超えたら断り、ファイルを分けてもらう (途中まで書いて止まるより分かりやすい)。
 */
export const CSV_MAX_ROWS = { stores: 1_000, cameras: 5_000 } as const

/** 上限を超えたときの応答の本文。画面は message をそのまま出す */
export function csvTooManyRows(rows: number, limit: number) {
  return {
    error:   'too_many_rows',
    message: `1 回に取り込めるのは ${limit.toLocaleString('en-US')} 行までです (${rows.toLocaleString('en-US')} 行)。ファイルを分けてください`,
    limit,
    rows,
  }
}
