/**
 * GET /api/edge/feedback/status の頁分け（GVMS_CLOUD_SPEC §12.3）。
 *
 * 古い順に最大 200 件を返し、続きがあれば next_since を付ける。拠点は next_since を
 * 次の since にして続けて取る（since は「より後」= updated_at > since）。
 *
 * 頁の境目で取りこぼさないための決まり:
 *   200 件目と 201 件目が同じ updated_at のとき、その時刻の行を今の頁から外し、
 *   ひとつ前の時刻を next_since にする（次の頁でその時刻の行がまとめて返る）。
 *   updated_at は DB のトリガで clock_timestamp() を使うので同時刻はまず起きないが、
 *   起きても抜けない形にしておく。頁全体が同時刻なら外さずに返す（無限に進まないのを避ける）。
 */

export const STATUS_PAGE_LIMIT = 200

export interface StatusRow {
  local_id: string | null
  id: string
  status: string
  reply: string | null
  fixed_version: string | null
  updated_at: string
}

/**
 * @param rows updated_at の古い順。limit + 1 件まで取ったもの（1 件多く取って続きの有無を知る）
 */
export function pageStatusRows(rows: StatusRow[], limit = STATUS_PAGE_LIMIT): { items: StatusRow[]; next_since: string | null } {
  if (rows.length <= limit) return { items: rows, next_since: null }
  let page = rows.slice(0, limit)
  const extra = rows[limit]
  const last = page[page.length - 1]
  if (last.updated_at === extra.updated_at) {
    const trimmed = page.filter((r) => r.updated_at !== last.updated_at)
    if (trimmed.length > 0) page = trimmed
  }
  return { items: page, next_since: page[page.length - 1].updated_at }
}
