/**
 * JMA 震度表記のフォーマッタ。
 * jalert_receipts / bcp_events の max_intensity は JMA XML の MaxInt 生値
 * （'1'〜'4', '5-', '5+', '6-', '6+', '7'）で保持し、表示時にのみ日本語化する。
 */
const INTENSITY_LABEL: Record<string, string> = {
  '1': '1', '2': '2', '3': '3', '4': '4',
  '5-': '5弱', '5+': '5強', '6-': '6弱', '6+': '6強', '7': '7',
}

/** 弱い順。'5弱' < '5強' のように文字列比較では並ばないため順序表を持つ。 */
const INTENSITY_ORDER = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']

/**
 * 震度を比較可能な順位へ。未知/未取得は 0（＝最弱扱い）。
 *
 * 発動判定側にも同じ関数が supabase/functions/jalert-poller/match.ts にある。
 * あちらは Deno から import するため src/ に依存できず、意図的に独立させている。
 * 対応表を変えるときは両方直すこと。
 */
export function intensityRank(code: string | null | undefined): number {
  const i = INTENSITY_ORDER.indexOf((code ?? '').trim())
  return i < 0 ? 0 : i + 1
}

/** '5-' → '震度5弱'。未知の値は生値のまま、null/空は null。 */
export function jmaIntensityLabel(code: string | null | undefined): string | null {
  const c = code?.trim()
  if (!c) return null
  const v = INTENSITY_LABEL[c]
  return v ? `震度${v}` : c
}
