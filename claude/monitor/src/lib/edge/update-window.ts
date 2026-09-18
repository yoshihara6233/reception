/**
 * nvmsd 自動更新の時間帯判定（OTA_SPEC §3・§4.1）。
 *
 * 判定は必ずサーバ側でやる — nvmsd に時計・時間帯の設定を持たせない
 * （時間帯の変更が nvmsd の更新なしで効く）。時刻はすべて JST。
 */

export const DEFAULT_WINDOW_START = '02:00'
export const DEFAULT_WINDOW_END = '05:00'

/** 'HH:MM' or 'HH:MM:SS'（Postgres time 列の戻り）→ 0..1439 分。壊れた値は null。 */
export function parseHhmm(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 現在時刻の JST 分（0..1439）。 */
export function nowJstMinutes(now: Date = new Date()): number {
  const jst = new Date(now.getTime() + 9 * 3600_000)
  return jst.getUTCHours() * 60 + jst.getUTCMinutes()
}

/**
 * 時間帯内か。start === end は「終日可」（UI では作らせないが、SQL 直編集で
 * 入った場合に更新が永遠に出ないより出る方が観測しやすい）。
 * 日跨ぎ（例 23:00→04:00）は wrap で判定。
 */
export function inUpdateWindow(
  nowMin: number,
  startStr: string | null | undefined,
  endStr: string | null | undefined,
): boolean {
  const start = parseHhmm(startStr) ?? parseHhmm(DEFAULT_WINDOW_START)!
  const end = parseHhmm(endStr) ?? parseHhmm(DEFAULT_WINDOW_END)!
  if (start === end) return true
  if (start < end) return nowMin >= start && nowMin < end
  return nowMin >= start || nowMin < end
}
