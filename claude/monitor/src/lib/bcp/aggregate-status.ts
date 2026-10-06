/**
 * BCP の一覧で、1 つの発令 (地震) にまとめた拠点の状態を 1 つに束ねる (F37)。
 *
 *   取得中が 1 つでもある → in_progress
 *   全部が失敗           → failed
 *   全部が終わった       → completed
 *   失敗と完了が混ざる   → partial (一部)
 *
 * 以前は「失敗が 1 つでもあれば失敗」だった。2026-10-06 から、証跡を取れる先が無い拠点
 * (G・VMS 未設置など) を発令の時点で失敗にするので、そのままだと大きな地震で取れた拠点が
 * 何百あっても、未設置の 1 拠点のせいで行全体が「失敗」と出てしまう。
 */
export type AggregatedBcpStatus = 'in_progress' | 'failed' | 'completed' | 'partial'

const DONE = new Set(['completed', 'report_generated', 'clips_uploaded'])

export function aggregateBcpStatus(statuses: readonly string[]): AggregatedBcpStatus {
  if (statuses.some((s) => s === 'pending' || s === 'recording')) return 'in_progress'
  if (statuses.length > 0 && statuses.every((s) => s === 'failed')) return 'failed'
  if (statuses.every((s) => DONE.has(s))) return 'completed'
  return 'partial'
}
