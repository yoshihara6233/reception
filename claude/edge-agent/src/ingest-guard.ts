/**
 * 命令に載ってきた ingest 先 URL の検証（多層防御）。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * `capture_snapshot` / `capture_alarm_timeline` は、撮った画像を命令に書かれた
 * `ingest_url` へ POST する。この URL を**外部から指定できると、店舗のカメラ画像を
 * 任意の宛先へ送り出せる**。
 *
 * 本来の境界はクラウド側にある（`/api/edges/[id]/commands` はユーザ経路では
 * これらの命令を受け付けない allowlist になっている）。ここはその内側でもう一枚
 * かける確認で、**クラウド側に将来穴が開いても、エッジが見知らぬ宛先へ画像を
 * 送らない**ようにするためのもの。
 *
 * ── MONITOR_URL 未設定のときの扱い ──────────────────────────────────────
 * 照合の基準が無いので**検証できない**。ここで一律に拒否すると、設定漏れの端末で
 * 巡回・発報の証跡取得が止まる（しかも「撮れていない」ことが現場から見えにくい）。
 * 実際に `MONITOR_URL` 未設定のまま稼働していた端末がある（2026-08-03 に判明）。
 *
 * そこで **判定できるときだけ拒否**し、判定できないときは通したうえで
 * `logger.error` で設定漏れとして鳴らす。証跡を黙って失うより、
 * 設定漏れを見えるようにするほうを取る。
 */
import { logger } from './logger.js'

export interface IngestGuardResult {
  allowed: boolean
  /** 判定の理由（ログとテスト用）。 */
  reason: 'same_origin' | 'no_baseline' | 'cross_origin' | 'unparsable'
}

/**
 * `url` が `monitorUrl` と同一オリジンか。
 *
 * @param url        命令に書かれていた ingest 先
 * @param monitorUrl 本部 URL（`config.MONITOR_URL`）。未設定なら undefined
 */
export function checkIngestUrl(url: string, monitorUrl: string | undefined): IngestGuardResult {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    // 相対 URL や壊れた文字列は fetch もできない。ここで落とす。
    return { allowed: false, reason: 'unparsable' }
  }

  if (!monitorUrl) return { allowed: true, reason: 'no_baseline' }

  let base: URL
  try {
    base = new URL(monitorUrl)
  } catch {
    // MONITOR_URL 自体が壊れている＝基準にならない。未設定と同じ扱い。
    return { allowed: true, reason: 'no_baseline' }
  }

  // protocol + host + port の一致を見る（`URL.origin` の定義そのもの）。
  return target.origin === base.origin
    ? { allowed: true,  reason: 'same_origin' }
    : { allowed: false, reason: 'cross_origin' }
}

/**
 * 検証してログを出す。`false` なら呼び出し側は送信を中止すること。
 *
 * @param action ログに残す命令名（どの経路で来たかを追えるように）
 */
export function allowIngestUrl(
  url: string,
  monitorUrl: string | undefined,
  action: string,
): boolean {
  const { allowed, reason } = checkIngestUrl(url, monitorUrl)

  if (reason === 'no_baseline') {
    // 検証を無効化したまま動いている状態。設定漏れとして目立たせる。
    logger.error({ action }, 'ingest-guard: MONITOR_URL 未設定のため ingest 先を検証できません')
  } else if (!allowed) {
    // ここに来たらクラウド側の allowlist を抜けている＝異常。URL ごと残す。
    logger.error({ action, url, reason }, 'ingest-guard: 想定外の ingest 先を拒否しました')
  }

  return allowed
}
