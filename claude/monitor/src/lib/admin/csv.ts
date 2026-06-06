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
