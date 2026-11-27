/**
 * 順送りの自動更新の進み具合の申告（NVMS/docs/GVMS_CLOUD_SPEC.md §15・WBS E-4-8）。
 *
 * サーバが 2 台以上の拠点は、クラウドから降りてきた更新を 1 台ずつ空にしてから当てる。
 * その進み具合を heartbeat の ota_rollout で受け、拠点の詳細に出す。
 * 守ること（§15.2）:
 *  - **形の崩れた ota_rollout で heartbeat を拒否しない。** 読めなければ null（＝申告なし）。
 *  - 保存するのは決めた項目だけ（拠点が余分な項目を送っても写さない）。
 */

export const CAP_OTA_ROLLOUT = 'ota_rollout'

export type OtaRolloutState = 'running' | 'done' | 'failed'
export type OtaRolloutPhase = 'drain' | 'empty' | 'apply' | 'settle'

export interface OtaRolloutStatus {
  version: string
  state: OtaRolloutState
  phase?: OtaRolloutPhase
  node?: string
  done: number
  total: number
  message?: string
  started_at?: string
  updated_at?: string
}

const STATES: readonly OtaRolloutState[] = ['running', 'done', 'failed']
const PHASES: readonly OtaRolloutPhase[] = ['drain', 'empty', 'apply', 'settle']
export const MAX_OTA_ROLLOUT_NODES = 64
export const MAX_OTA_ROLLOUT_MESSAGE = 500

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
const time = (v: unknown): string | null => {
  const s = str(v, 40)
  return s && !Number.isNaN(Date.parse(s)) ? s : null
}

/** heartbeat の ota_rollout を保存できる形に整える。読めなければ null（＝申告なし）。 */
export function sanitizeOtaRollout(input: unknown): OtaRolloutStatus | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const version = str(o.version, 64)
  const state = STATES.find((s) => s === o.state)
  const total = typeof o.total === 'number' && Number.isInteger(o.total) ? o.total : 0
  if (!version || !state || total < 1 || total > MAX_OTA_ROLLOUT_NODES) return null
  const doneRaw = typeof o.done === 'number' && Number.isInteger(o.done) ? o.done : 0
  const out: OtaRolloutStatus = { version, state, done: Math.min(Math.max(doneRaw, 0), total), total }
  const phase = PHASES.find((p) => p === o.phase)
  if (state === 'running' && phase) out.phase = phase
  const node = str(o.node, 64)
  if (node && state !== 'done') out.node = node
  const message = str(o.message, MAX_OTA_ROLLOUT_MESSAGE)
  if (message && state === 'failed') out.message = message
  const started = time(o.started_at)
  if (started) out.started_at = started
  const updated = time(o.updated_at)
  if (updated) out.updated_at = updated
  return out
}

const PHASE_LABEL: Record<OtaRolloutPhase, string> = {
  drain: 'カメラを他のサーバへ移しています',
  empty: 'カメラが移り終わるのを待っています',
  apply: '入れ替えています',
  settle: 'カメラを戻して落ち着くのを待っています',
}

export interface OtaRolloutView {
  tone: 'running' | 'done' | 'failed'
  /** 札に出す短い言葉 */
  badge: string
  /** 1 行の説明 */
  text: string
  /** 止めた理由（failed のときだけ） */
  detail: string | null
}

/** 画面に出す言葉。判定はここ 1 か所に置く（詳細と一覧でずれないように）。 */
export function otaRolloutView(st: OtaRolloutStatus): OtaRolloutView {
  const n = (v: number) => v.toLocaleString('ja-JP')
  if (st.state === 'done') {
    return { tone: 'done', badge: '1 台ずつ更新 完了', text: `版 ${st.version} へ ${n(st.total)} 台を 1 台ずつ更新しました。`, detail: null }
  }
  if (st.state === 'failed') {
    return {
      tone: 'failed',
      badge: '1 台ずつ更新 停止',
      text: `版 ${st.version} への更新を${st.node ? ` ${st.node} で` : ''}止めました（${n(st.done)} / ${n(st.total)} 台が更新済み）。残りのサーバは前の版のままです。`,
      detail: st.message ?? null,
    }
  }
  const current = Math.min(st.done + 1, st.total)
  const what = st.phase ? PHASE_LABEL[st.phase] : '進めています'
  return {
    tone: 'running',
    badge: `1 台ずつ更新中 ${n(st.done)} / ${n(st.total)} 台`,
    text: `版 ${st.version} へ更新中です。${n(st.total)} 台中 ${n(current)} 台目${st.node ? `（${st.node}）` : ''}: ${what}。`,
    detail: null,
  }
}
