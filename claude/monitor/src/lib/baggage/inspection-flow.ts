/**
 * 手荷物検査 iPad キオスクフローの純ロジック（M2）
 *
 * I/O を持たない純関数のみ。UI（初期グリッド・STEP進行・タイムアウト）と
 * API（区分×動作の受理）の双方から使う。
 *
 * 設計: 承認ワイヤーフレーム v3（D5・D6・D13・D17）。
 * 設定値は inspection_settings（store 単位）から供給される。
 */

export type PersonKind = 'staff' | 'visitor'
export type TerminalMode = 'both' | 'entry_only' | 'exit_only'
export type FlowAction = 'entry' | 'temp_exit' | 'temp_return' | 'exit'

export const ALL_ACTIONS: FlowAction[] = ['entry', 'temp_exit', 'temp_return', 'exit']

/** 端末モードに応じて初期グリッドに表示する動作（D6・D17）。 */
export function availableActions(mode: TerminalMode): FlowAction[] {
  switch (mode) {
    case 'entry_only': return ['entry', 'temp_return']
    case 'exit_only':  return ['exit', 'temp_exit']
    case 'both':
    default:           return ALL_ACTIONS
  }
}

/** 検査STEP（アナウンス）を伴うのは最終「退室」のみ。途中系・入室は顔認証のみ（D17）。 */
export function requiresInspection(action: FlowAction): boolean {
  return action === 'exit'
}

/** 途中系イベント（検査・クリップなし）か。 */
export function isTempEvent(action: FlowAction): action is 'temp_exit' | 'temp_return' {
  return action === 'temp_exit' || action === 'temp_return'
}

export interface AnnounceStep {
  order: number
  text: string
}

/** STEP文言の全角換算の上限（画面64px表示の破綻防止・D13）。 */
export const STEP_TEXT_MAX = 40

const DEFAULT_STEPS: AnnounceStep[] = [
  { order: 1, text: 'カバンの中身を出してください' },
  { order: 2, text: 'カバンの中身を撮影してください' },
]

/**
 * inspection_settings.announce_steps を正規化する。
 *   - 未設定/空 → 既定2STEP
 *   - order 昇順・text を STEP_TEXT_MAX で切り詰め・空textは除外
 */
export function normalizeAnnounceSteps(raw: unknown): AnnounceStep[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_STEPS]
  const steps = raw
    .map((s, i) => {
      const text = typeof (s as { text?: unknown })?.text === 'string' ? (s as { text: string }).text.trim() : ''
      const order = Number((s as { order?: unknown })?.order)
      return { order: Number.isFinite(order) ? order : i + 1, text: text.slice(0, STEP_TEXT_MAX) }
    })
    .filter((s) => s.text !== '')
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ order: i + 1, text: s.text }))
  return steps.length ? steps : [...DEFAULT_STEPS]
}

export type StepPhase =
  | { kind: 'step'; index: number; total: number; text: string }
  | { kind: 'complete' }

/** STEP を1つ進める。最終STEPの「次へ」で complete。 */
export function advanceStep(steps: AnnounceStep[], current: number): StepPhase {
  const total = steps.length
  const next = current + 1
  if (next >= total) return { kind: 'complete' }
  return { kind: 'step', index: next, total, text: steps[next].text }
}

/** 検査開始時の最初のSTEP。 */
export function firstStep(steps: AnnounceStep[]): StepPhase {
  if (steps.length === 0) return { kind: 'complete' }
  return { kind: 'step', index: 0, total: steps.length, text: steps[0].text }
}

/** 無操作タイムアウト（各STEP・秒）。inspection_settings.inspection_timeout_sec 既定120。 */
export const DEFAULT_STEP_TIMEOUT_SEC = 120
/** 完了/途中記録の自動アイドル復帰（秒）。 */
export const AUTO_IDLE_SEC = 3
/** 顔認証の最大待ち（秒）。超過で auth_skipped を立ててフロー継続（可用性優先）。 */
export const FACE_AUTH_TIMEOUT_SEC = 3
/**
 * サーバ側の Rekognition 照合/登録タイムアウト（秒）。
 * FACE_AUTH_TIMEOUT_SEC（3秒）は「キオスクの体感上限」だが、実際の Rekognition 呼び出しは
 * コールドスタート時に3秒を超えて false timeout になり「認証省略」を量産する。
 * サーバ側の実タイムアウトはこちらで別に持つ（温間は 1秒前後で返る）。
 */
export const FACE_SEARCH_TIMEOUT_SEC = 8
