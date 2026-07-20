/**
 * トンネル死活の状態遷移（純ロジック・G1: エッジ/トンネル断の5分内通知）。
 *
 * heartbeat 死活（last_seen_at/alerted_at）と対になる、cloudflared トンネル
 * （go2rtc への遠隔経路）の監視。プローブ結果とDB上の状態から「次の状態」と
 * 「取るべき通知アクション」を決める。cron 側はこの結果を保存/送信するだけ。
 *
 * フラップ吸収: 失敗1回では通知せず、初回失敗時刻(tunnel_down_since)から
 * alertAfterSec（既定180秒）継続して落ちている場合のみ通知する。
 * cron 2分毎 + 3分閾値 ＝ 障害発生から約5分以内に通知（heartbeat と同じ約束）。
 */

export interface TunnelState {
  /** プローブ失敗を最初に観測した時刻（ISO）。成功で null。 */
  downSince: string | null
  /** ダウン通知済み時刻（ISO）。復旧通知後 null。 */
  alertedAt: string | null
}

export interface TunnelDecision extends TunnelState {
  /** none=何もしない / alert=ダウン通知を送る / recover=復旧通知を送る */
  action: 'none' | 'alert' | 'recover'
}

/** 通知までの継続ダウン時間（秒）。heartbeat の stale 閾値と同じ既定3分。 */
export const TUNNEL_ALERT_AFTER_SEC = 180

export function nextTunnelState(
  probeOk: boolean,
  cur: TunnelState,
  nowMs: number,
  alertAfterSec: number = TUNNEL_ALERT_AFTER_SEC,
): TunnelDecision {
  if (probeOk) {
    // 復旧: 通知済みだった場合のみ復旧通知。観測中(未通知)なら黙って揉み消す。
    if (cur.alertedAt) return { downSince: null, alertedAt: null, action: 'recover' }
    if (cur.downSince) return { downSince: null, alertedAt: null, action: 'none' }
    return { downSince: null, alertedAt: null, action: 'none' }
  }

  // 失敗: 初回観測なら downSince を刻むだけ（フラップ吸収）。
  if (!cur.downSince) {
    return { downSince: new Date(nowMs).toISOString(), alertedAt: cur.alertedAt, action: 'none' }
  }

  // 継続失敗: 閾値超過かつ未通知ならアラート。
  const downMs = nowMs - new Date(cur.downSince).getTime()
  if (!cur.alertedAt && downMs >= alertAfterSec * 1000) {
    return { downSince: cur.downSince, alertedAt: new Date(nowMs).toISOString(), action: 'alert' }
  }
  return { downSince: cur.downSince, alertedAt: cur.alertedAt, action: 'none' }
}

/**
 * プローブ結果の解釈。トンネル(Cloudflare)はオリジン到達不能時に 5xx
 * （530=tunnel down / 502 / 504 等）を返すため、5xx とネットワーク例外を
 * 「断」とみなす。4xx（認証・パス起因）はトンネル自体は生きている＝正常。
 */
export function probeStatusOk(status: number): boolean {
  return status < 500
}
