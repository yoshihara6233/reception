import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 運用点検の実行記録。**「通知が来ない」を「正常」と読めるようにする。**
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * 日次点検（/api/cron/partition-health）は問題があったときだけ通知する。
 * つまり沈黙が **5 通り**の意味を持っていた:
 *
 *   ① 正常  ② CRON_SECRET 未設定(503)  ③ 認証失敗(401)
 *   ④ RPC 失敗(500・**通知せずに返っていた**)  ⑤ cron が動いていない
 *
 * 2026-08-12 に実際に確かめようとしたところ、Vercel のログを人が掘るしか
 * 手が無かった。**2 日かけて潰してきた「壊れているのに正常と区別が付かない」
 * 形を、監視自身が持っていた。**
 *
 * 対処は 3 つで、3 つ揃って初めて沈黙が意味を持つ:
 *   ・毎回の結果を残す（この関数）
 *   ・失敗も通知に回す（呼び出し側）
 *   ・鮮度を**別の cron** が見張る（edge-health・2 分間隔）
 */

export type CheckSeverity = 'ok' | 'warn' | 'critical'

/** 日次点検の名前。記録の突き合わせに使うので文字列を散らさない。 */
export const DAILY_CHECK = 'partition-health'

/**
 * 実行を 1 行残す。**記録に失敗しても点検自体は止めない**が、
 * 黙って捨てもしない（記録が無い＝鮮度の判定が効かなくなるため）。
 * 戻り値は「記録できたか」。呼び出し側はこれを指摘に足す。
 */
export async function recordCheckRun(
  svc: SupabaseClient,
  check: string,
  severity: CheckSeverity,
  problems: string[],
  durationMs: number,
): Promise<boolean> {
  const { error } = await svc.rpc('record_check_run', {
    p_check:       check,
    p_severity:    severity,
    // 値そのものは入れない契約。ここに渡すのは指摘の文言だけ。
    p_problems:    problems,
    p_duration_ms: Math.max(0, Math.round(durationMs)),
  })
  if (error) {
    console.error('[ops] record_check_run failed:', error.message)
    return false
  }
  return true
}

export interface StaleVerdict {
  /** 記録が無い、または max_age より古い。 */
  stale: boolean
  /** 直近の実行時刻。未実行なら null。 */
  lastRanAt: string | null
  /** 今この場で通知すべきか（重複抑止の判定込み）。 */
  shouldAlert: boolean
}

/**
 * 日次点検の鮮度を見て、通知すべきなら**通知記録を立てて**返す。
 *
 * ⚠ 判定と通知記録は DB 側の 1 文に畳んである（`claim_stale_check_alert`）。
 *   見張り役の edge-health は 2 分間隔なので、分けて書くと同時に走った
 *   2 本が両方通知する——今週ずっと直してきた形と同じ。
 *
 * ⚠ **判定できないときは通知しない**（`shouldAlert: false`）。ここを
 *   フェイルオープンにしているのは、2 分ごとの cron から誤報を出し続けると
 *   本物のアラートが埋もれるため。RPC が落ちていること自体は
 *   edge-health 側の応答に載せて、そちらで見えるようにする。
 */
export async function claimStaleCheckAlert(
  svc: SupabaseClient,
  check: string = DAILY_CHECK,
): Promise<StaleVerdict | null> {
  const { data, error } = await svc
    .rpc('claim_stale_check_alert', { p_check: check })
    .single<{ stale: boolean; last_ran_at: string | null; should_alert: boolean }>()
  if (error || !data) {
    console.error('[ops] claim_stale_check_alert failed:', error?.message)
    return null
  }
  return { stale: data.stale, lastRanAt: data.last_ran_at, shouldAlert: data.should_alert }
}

/** 人が読む 1 行。メール件名・Slack に出す。 */
export function staleMessage(check: string, lastRanAt: string | null): string {
  return lastRanAt
    ? `日次点検（${check}）が ${lastRanAt} 以降走っていません`
    : `日次点検（${check}）の実行記録がありません`
}
