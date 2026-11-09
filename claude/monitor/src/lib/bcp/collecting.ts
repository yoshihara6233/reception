/**
 * BCP のイベントが「まだ収集中か」(2026-11-04・シナリオ試験の所見)。
 *
 * 詳細の自動の読み直し (app/bcp/[id]/AutoRefresh.tsx) と、一覧の「進行中」の扱いで使う。
 * テスト発令は拠点がオフラインのままだと収集が決着せず、いつまでも進行中に残っていた
 * (10/05・9/30 のテスト発令)。テスト発令は発令から TEST_EVENT_STALE_MS を過ぎたら終わりとみなす。
 * 本番の発令は期限で打ち切らない (証跡の取り残しを「終わった」と見せないため)。
 */

/** 収集の途中の状態 (コマの決着待ち・PDF の作成待ち)。 */
export const IN_PROGRESS_STATUSES = ['pending', 'recording', 'clips_uploaded'] as const

/** テスト発令を「終わった」とみなすまでの時間。 */
export const TEST_EVENT_STALE_MS = 24 * 60 * 60_000

/** テスト発令で、発令 (作成) から期限を過ぎたものか。 */
export function isStaleTestEvent(
  e: { is_test: boolean | null; created_at: string },
  nowMs: number = Date.now(),
): boolean {
  if (!e.is_test) return false
  const t = new Date(e.created_at).getTime()
  return Number.isFinite(t) && nowMs - t > TEST_EVENT_STALE_MS
}

/**
 * 詳細を読み直し続けるか。状態が収集の途中か、決着していないコマが残っている間。
 * 生画像を消した後と、期限切れのテスト発令は読み直さない (決着しないものを読み続けない)。
 * 本番の発令も、発令から 1 日を過ぎたら読み直しは止める (画面を開きっぱなしにした場合の保険)。
 */
export function shouldAutoRefreshBcp(
  e: { status: string; is_test: boolean | null; created_at: string; raw_purged_at?: string | null },
  hasUnsettledShots: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (e.raw_purged_at) return false
  const t = new Date(e.created_at).getTime()
  if (!Number.isFinite(t) || nowMs - t > TEST_EVENT_STALE_MS) return false
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(e.status) || hasUnsettledShots
}

/**
 * 一覧に出す状態。期限を過ぎたテスト発令で、まだ収集の途中の状態のものは expired (終了) にする。
 * **表示だけの判定で、DB の状態は変えない** (詳細では元の状態のまま見える・再取得もできる)。
 */
export function bcpListStatus(
  e: { status: string; is_test: boolean | null; created_at: string },
  nowMs: number = Date.now(),
): string {
  if ((IN_PROGRESS_STATUSES as readonly string[]).includes(e.status) && isStaleTestEvent(e, nowMs)) return 'expired'
  return e.status
}

/** 画像がそろって PDF の自動作成を待つ間の読み直しの間隔。 */
export const BCP_REFRESH_PDF_WAIT_MS = 5_000
/** それ以外の収集中の読み直しの間隔。 */
export const BCP_REFRESH_MS = 20_000

/**
 * 詳細を読み直す間隔 (2026-11-09・シナリオ試験 2 周目 6-11 の所見)。
 * 画像がそろうと (clips_uploaded) 毎分の見回りが 1 分ほどで PDF を作る。20 秒ごとだと
 * できた後も最大 20 秒「まだ生成されていません」のままで、待っていた人が手で作り直していた。
 * PDF を待つ間だけ短くする。
 */
export function bcpRefreshMs(status: string): number {
  return status === 'clips_uploaded' ? BCP_REFRESH_PDF_WAIT_MS : BCP_REFRESH_MS
}

/** 画像がそろい、PDF の自動作成を待っている状態か (レポートがまだ無いとき)。 */
export function isAwaitingAutoPdf(status: string, hasReport: boolean): boolean {
  return status === 'clips_uploaded' && !hasReport
}
