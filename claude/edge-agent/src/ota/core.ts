/**
 * 自律OTA の純ロジック（副作用なし・単体テスト対象）。
 *
 * git / fs / systemctl を叩く副作用は `runner.ts` に分離する。本ファイルは
 * 「いま更新すべきか」「再起動後に健全か」「promote / rollback どちらか」を
 * 入力（現行版・desired版・OTA状態・健全性プローブ）から決める判断だけを持つ。
 *
 * 安全設計（docs/edge-ota-design.md §2,§3）:
 *  - per-device desired = カナリア。desired != 現行 のときだけ更新。
 *  - 更新中/検証待ち中は新たな更新を始めない（多重起動ガード）。
 *  - ロールバックした desired は、desired が変わるまで再突入しない（クールダウン）。
 *  - 健全性 = 「新版で heartbeat がクラウドへ到達」かつ「M秒間プロセスが安定」。
 */

/** OTA 状態（shared/ota-state.json に永続化・再起動を跨ぐ）。 */
export type OtaStatus =
  | 'idle' // 何もしていない（現行版で安定）
  | 'updating' // release 展開〜symlink切替〜restart 要求まで
  | 'pending_verify' // 新版で再起動済み・健全性プローブ中
  | 'healthy' // 新版が健全＝known-good 昇格済み
  | 'rolled_back' // 新版が不健全/DOA で known-good へ復帰済み

export interface OtaState {
  /** いま動いている版（releases/current/VERSION）。 */
  running_version: string
  /** ロールバック先（健全実績のある版）。初回は running と同じ。 */
  known_good_version: string | null
  /** 再起動後に健全性を確認すべき版。null=検証待ちなし。 */
  pending_verify_version: string | null
  /** 直近にロールバックした desired 版（同一 desired への再突入を防ぐ）。 */
  last_failed_version: string | null
  status: OtaStatus
  /** 同一更新サイクルでの試行回数（無限ループ抑止）。 */
  attempts: number
  /** 直近の失敗理由（admin 可視化用）。 */
  last_error: string | null
  updated_at: string | null
}

/** クラウドが宣言する desired 版（bootstrap 応答）。NULL=更新指示なし。 */
export interface DesiredVersions {
  agent: string | null
  cloudflared: string | null
}

/** 健全性プローブの入力。 */
export interface HealthProbeInput {
  /** 新版で打った heartbeat がクラウドへ到達したか。 */
  heartbeatReached: boolean
  /** 起動からの経過ms（プロセス安定時間）。 */
  stableMs: number
  /** 安定とみなす閾値ms。 */
  minStableMs: number
}

/** 既定のしきい値（config で上書き可）。 */
export const OTA_DEFAULTS = {
  /** 健全とみなすまでの最小安定時間（ms）。 */
  MIN_STABLE_MS: 90_000,
  /** heartbeat 到達を待つ猶予（ms）。これを過ぎて未到達なら不健全。 */
  HEARTBEAT_GRACE_MS: 90_000,
  /** 1更新サイクルの最大試行回数。 */
  MAX_ATTEMPTS: 1,
} as const

/** 初期 OTA 状態（現行版を known-good 兼用で立ち上げる）。 */
export function initialState(runningVersion: string, now: string): OtaState {
  return {
    running_version: runningVersion,
    known_good_version: runningVersion,
    pending_verify_version: null,
    last_failed_version: null,
    status: 'idle',
    attempts: 0,
    last_error: null,
    updated_at: now,
  }
}

export interface UpdateDecision {
  update: boolean
  reason: string
}

/**
 * desired 版に向けてエージェント更新を始めるべきか。
 * desired が null / 現行と同じ / 進行中 / 検証待ち / 失敗版のクールダウン中 は始めない。
 */
export function shouldUpdateAgent(
  running: string,
  desired: string | null,
  state: OtaState,
): UpdateDecision {
  if (!desired) return { update: false, reason: 'no_desired' }
  if (desired === running) return { update: false, reason: 'already_current' }
  if (state.status === 'updating' || state.status === 'pending_verify') {
    return { update: false, reason: 'in_progress' }
  }
  if (state.pending_verify_version) return { update: false, reason: 'verify_pending' }
  // 直近にロールバックした版と同じ desired は、desired が変わるまで再突入しない。
  if (state.last_failed_version && state.last_failed_version === desired) {
    return { update: false, reason: 'cooldown_failed_version' }
  }
  return { update: true, reason: 'desired_changed' }
}

export type HealthVerdict = 'healthy' | 'unhealthy' | 'pending'

export interface HealthResult {
  verdict: HealthVerdict
  reason: string
}

/**
 * 再起動後の健全性判定。
 *  - heartbeat 未到達かつ猶予内 → pending（まだ待つ）
 *  - heartbeat 未到達かつ猶予超過 → unhealthy（ロールバック）
 *  - heartbeat 到達したが安定時間不足 → pending
 *  - heartbeat 到達かつ安定 → healthy
 */
export function evaluateHealth(p: HealthProbeInput): HealthResult {
  if (!p.heartbeatReached) {
    if (p.stableMs >= p.minStableMs) {
      return { verdict: 'unhealthy', reason: 'no_heartbeat_within_window' }
    }
    return { verdict: 'pending', reason: 'awaiting_heartbeat' }
  }
  if (p.stableMs < p.minStableMs) return { verdict: 'pending', reason: 'awaiting_stable' }
  return { verdict: 'healthy', reason: 'heartbeat_and_stable' }
}

/** 更新開始（symlink 切替・restart 要求の直前）。pending_verify を記録する。 */
export function beginUpdate(state: OtaState, target: string, now: string): OtaState {
  return {
    ...state,
    status: 'updating',
    pending_verify_version: target,
    attempts: state.attempts + 1,
    last_error: null,
    updated_at: now,
  }
}

/** 新版で再起動した直後（検証フェーズ入り）。 */
export function enterPendingVerify(state: OtaState, now: string): OtaState {
  return { ...state, status: 'pending_verify', updated_at: now }
}

/** 健全確認 → known-good 昇格。クールダウンもクリア。 */
export function promoteHealthy(state: OtaState, now: string): OtaState {
  const promoted = state.pending_verify_version ?? state.running_version
  return {
    ...state,
    running_version: promoted,
    known_good_version: promoted,
    pending_verify_version: null,
    last_failed_version: null,
    status: 'healthy',
    attempts: 0,
    last_error: null,
    updated_at: now,
  }
}

/**
 * 不健全/DOA → known-good へ復帰。失敗版をクールダウン対象に記録する。
 * running は known-good に戻る（symlink を戻したあとの真実）。
 */
export function markRolledBack(state: OtaState, reason: string, now: string): OtaState {
  const failed = state.pending_verify_version
  return {
    ...state,
    running_version: state.known_good_version ?? state.running_version,
    pending_verify_version: null,
    last_failed_version: failed,
    status: 'rolled_back',
    last_error: reason,
    updated_at: now,
  }
}

/**
 * 再起動後の1回分の検証ステップ。pending_verify が無ければ何もしない。
 * 健全 → promote / 不健全 → rollback要求 / pending → 継続。
 * 返り値の `action` を runner が解釈して symlink 操作や restart を行う。
 */
export type VerifyAction = 'promote' | 'rollback' | 'wait' | 'noop'

export interface VerifyStep {
  action: VerifyAction
  state: OtaState
  reason: string
}

export function verifyStep(state: OtaState, probe: HealthProbeInput, now: string): VerifyStep {
  if (!state.pending_verify_version) {
    return { action: 'noop', state, reason: 'no_pending_verify' }
  }
  const health = evaluateHealth(probe)
  if (health.verdict === 'healthy') {
    return { action: 'promote', state: promoteHealthy(state, now), reason: health.reason }
  }
  if (health.verdict === 'unhealthy') {
    return { action: 'rollback', state: markRolledBack(state, health.reason, now), reason: health.reason }
  }
  return { action: 'wait', state, reason: health.reason }
}
