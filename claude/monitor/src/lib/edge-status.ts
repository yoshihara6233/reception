/**
 * TC3: 監視中断の見える化 — エッジ状態の **単一源** 派生ロジック。
 *
 * 背景（埋める穴）:
 *   edge_devices.status はエッジが書く「動作モード文字列」(grid/live/vod/...)。
 *   ところが status='offline' を書くのはエッジの正常終了時だけで、クラッシュ・
 *   電源断・回線断・クラウドリンク断では status は最後のモード(grid 等)のまま
 *   固着し、last_seen_at だけが古くなる。死活 cron も alerted_at を立てるだけで
 *   status は触らない。結果、監視が止まっているのに UI は「● 監視中」を出し続ける。
 *
 * 方針（DB変更なし・派生のみ）:
 *   last_seen_at の鮮度を **真実源** とする。MONITOR_STALE_SECONDS を超えて無応答
 *   なら status 文字列を無視して plane='interrupted'（監視中断）に上書きする。
 *   この派生を 1 箇所に集約し、StoreDetail / stores ダッシュボード / アラート算出 /
 *   死活 cron が同じ判定を共有する。
 *
 * 監視/録画区別:
 *   監視プレーン（エッジ↔クラウド）が中断しても、録画は i-PRO NVR 本体が自律で
 *   継続する（docs: 録画はエッジ自律・監視プレーンは SaaS と分離定義）。中断/停止
 *   時は recordingContinues=true を返し、UI が「録画はレコーダ本体で継続中」と
 *   明示できるようにする＝顧客に「映像が消える訳ではない」ことを伝える。
 */
import { MONITOR_STALE_SECONDS } from '@intereco/shared'

/**
 * 監視プレーンの状態（status 文字列ではなく「クラウドから見た生存」で分類）。
 *   - monitoring   : 鮮度OK・動作中（直近モードを mode に保持）
 *   - interrupted  : 無応答が閾値超過＝異常中断（クラッシュ/回線断/電源断）
 *   - stopped      : 鮮度OK かつ status='offline'＝意図的な正常停止
 *   - unconfigured : 一度も応答なし（last_seen_at null）＝未設置
 */
export type EdgePlane = 'monitoring' | 'interrupted' | 'stopped' | 'unconfigured'

export type EdgeTone = 'ok' | 'idle' | 'warn' | 'down'

export interface DerivedEdgeStatus {
  /** 監視プレーンの状態（真実源 = last_seen_at 鮮度） */
  plane: EdgePlane
  /** 直近の動作モード（interrupted 時は固着値＝参考情報、monitoring 時は現モード） */
  mode: string | null
  /** last_seen_at からの経過秒（null = 未設置） */
  staleSec: number | null
  /** 監視/録画区別: 監視中断/停止でも録画は NVR 本体で継続するか */
  recordingContinues: boolean
  /** バッジ配色などの意味づけ */
  tone: EdgeTone
}

export interface DeriveEdgeStatusOpts {
  /** 判定基準時刻（テスト用に注入可能。既定 Date.now()） */
  nowMs?: number
  /** 中断判定の許容遅延秒（既定 MONITOR_STALE_SECONDS） */
  staleSec?: number
}

/**
 * エッジの生の status / last_seen_at から監視プレーン状態を派生する純関数。
 * サーバ/クライアント両方から呼べる（外部I/Oなし）。
 */
export function deriveEdgeStatus(
  rawStatus: string | null | undefined,
  lastSeenAt: string | null | undefined,
  opts: DeriveEdgeStatusOpts = {},
): DerivedEdgeStatus {
  const now      = opts.nowMs ?? Date.now()
  const staleSec = opts.staleSec ?? MONITOR_STALE_SECONDS

  // 未設置: 一度も heartbeat が届いていない。
  if (!lastSeenAt) {
    return { plane: 'unconfigured', mode: null, staleSec: null, recordingContinues: false, tone: 'idle' }
  }

  const seenMs = new Date(lastSeenAt).getTime()
  // パース不能な値は安全側に倒して「未設置」扱い（false positive の中断通知を避ける）。
  if (Number.isNaN(seenMs)) {
    return { plane: 'unconfigured', mode: rawStatus ?? null, staleSec: null, recordingContinues: false, tone: 'idle' }
  }

  const ageSec = Math.max(0, Math.floor((now - seenMs) / 1000))

  // 真実源: 無応答が閾値超過 → status 文字列を無視して「監視中断」。
  if (ageSec >= staleSec) {
    return { plane: 'interrupted', mode: rawStatus ?? null, staleSec: ageSec, recordingContinues: true, tone: 'down' }
  }

  // 鮮度OK かつ正常終了マーカー → 意図的停止（録画は継続）。
  if (rawStatus === 'offline') {
    return { plane: 'stopped', mode: 'offline', staleSec: ageSec, recordingContinues: true, tone: 'idle' }
  }

  // 鮮度OK だがエッジ自身がエラー報告中（NVR 到達不可など）。録画継続は断定しない。
  if (rawStatus === 'error') {
    return { plane: 'monitoring', mode: 'error', staleSec: ageSec, recordingContinues: false, tone: 'warn' }
  }

  // 鮮度OK・動作中。
  return { plane: 'monitoring', mode: rawStatus ?? 'idle', staleSec: ageSec, recordingContinues: false, tone: 'ok' }
}

/** plane が監視中断/停止（＝顧客に明示すべき非監視状態）か。 */
export function isMonitoringDown(d: DerivedEdgeStatus): boolean {
  return d.plane === 'interrupted' || d.plane === 'stopped'
}
