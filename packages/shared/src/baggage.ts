/**
 * 手荷物検査クリップジョブの純ロジック（monitor + edge-agent 共有）
 *
 * monitor（キオスクAPIがジョブ生成）と edge-agent（切り出しワーカがジョブ消化）が
 * 同じ検査窓・尺検査・バックオフ・期限の契約を使うため @intereco/shared に置く。
 * I/O なし・副作用なし。
 */

const SEC = 1000
const MIN = 60 * SEC
const DAY = 24 * 60 * MIN

export interface ClipJobSettings {
  /** 検査窓の前バッファ秒（既定15）。NVR時計ずれの緩和も兼ねる。 */
  preBufferSec?: number
  /** 検査窓の後バッファ秒（既定15）。 */
  postBufferSec?: number
  /** not_before = window_to + この分数（退出直後の未確定録画での誤報防止・既定5）。 */
  notBeforeMin?: number
  /** NVR の録画保持日数（deadline = 検査終了 + (これ-2)日）。 */
  nvrRetentionDays: number
}

export interface ClipJobSpec {
  cameraId: string
  windowFrom: Date
  windowTo: Date
  notBefore: Date
  deadlineAt: Date
}

/**
 * セッションの検査窓とカメラ一覧からジョブ仕様を作る。
 * completed だけでなく interrupted / auth_skipped でも呼ぶ（全退出系でジョブ生成）。
 */
export function buildClipJobs(
  input: { inspectionStartedAt: Date; inspectionEndedAt: Date; cameraIds: string[] },
  settings: ClipJobSettings,
): ClipJobSpec[] {
  const pre = (settings.preBufferSec ?? 15) * SEC
  const post = (settings.postBufferSec ?? 15) * SEC
  const notBeforeMs = (settings.notBeforeMin ?? 5) * MIN
  const retentionMs = Math.max(0, settings.nvrRetentionDays - 2) * DAY

  const windowFrom = new Date(input.inspectionStartedAt.getTime() - pre)
  const windowTo = new Date(input.inspectionEndedAt.getTime() + post)
  const notBefore = new Date(windowTo.getTime() + notBeforeMs)
  const deadlineAt = new Date(input.inspectionEndedAt.getTime() + retentionMs)

  return input.cameraIds.map((cameraId) => ({ cameraId, windowFrom, windowTo, notBefore, deadlineAt }))
}

export interface ClipReport {
  windowFrom: Date
  windowTo: Date
  reportedDurationSec: number
  clockOffsetSec: number
}

export interface ClipValidation {
  ok: boolean
  reasons: string[]
  expectedSec: number
}

/**
 * 切り出し結果の健全性検査。
 *   - 尺が期待窓の minRatio(既定0.8) 未満 → 不健全（短尺＝未確定録画/欠損の疑い）
 *   - 時計ズレが maxOffsetSec を超過 → 不健全（時間帯違いの映像の疑い）
 */
export function validateClipReport(
  report: ClipReport,
  opts: { minRatio?: number; maxOffsetSec?: number } = {},
): ClipValidation {
  const minRatio = opts.minRatio ?? 0.8
  const maxOffset = opts.maxOffsetSec ?? 3
  const expectedSec = Math.max(0, (report.windowTo.getTime() - report.windowFrom.getTime()) / SEC)
  const reasons: string[] = []

  if (expectedSec > 0 && report.reportedDurationSec < expectedSec * minRatio) {
    reasons.push(`duration ${report.reportedDurationSec}s below ${Math.round(minRatio * 100)}% of expected ${expectedSec}s`)
  }
  if (Math.abs(report.clockOffsetSec) > maxOffset) {
    reasons.push(`clock offset ${report.clockOffsetSec}s exceeds ${maxOffset}s`)
  }
  return { ok: reasons.length === 0, reasons, expectedSec }
}

/** 指数バックオフの遅延（秒）。retryCount 番目の再試行までの待ち。 */
export const RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 21600] as const

/** retryCount 回目の失敗後、次に試すべき時刻。 */
export function nextRetryAt(retryCount: number, from: Date): Date {
  const idx = Math.min(Math.max(retryCount, 0), RETRY_DELAYS_SEC.length - 1)
  return new Date(from.getTime() + RETRY_DELAYS_SEC[idx] * SEC)
}

/** deadline を過ぎたか（超過なら失敗確定→通知）。 */
export function isPastDeadline(deadlineAt: Date, now: Date): boolean {
  return now.getTime() > deadlineAt.getTime()
}
