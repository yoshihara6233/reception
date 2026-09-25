/**
 * 遠隔視聴のセッションの決まり（GVMS_CLOUD_SPEC §5.1）— DB にも R2 にも触れない純粋な部分。
 *
 * 1 回の視聴 = 1 セッション（video_sessions の 1 行）。拠点への指示は pending_command の
 * 1 枠に載せず、commands/next が拠点のポーリングのたびに**次に渡す 1 件**をここで選ぶ。
 * 拠点（nvmsd）は指示を 1 件受けると間を空けずに次を取りに来るので、1 回に 1 件で足りる。
 *
 * 生存の合図の考え方:
 *  - 視聴画面は 10 秒ごとにクラウドへ生存を知らせる（viewer_seen_at）。
 *  - クラウドは画面が生きている間だけ、30 秒ごとに refresh_video を拠点へ渡す。
 *  - 画面の生存が 25 秒途切れたら、合図を止めるだけでなく stop_video を渡す。
 *    拠点の 60 秒の合図切れを待つと、最後の合図の直後に画面が落ちた場合に
 *    「画面を閉じると 60 秒以内に止まる」（§7-1）を超えるため。
 */

export type VideoKind = 'hls_live' | 'hls_vod' | 'sfu'
export type VideoState = 'requested' | 'dispatched' | 'started' | 'ended' | 'stopped' | 'error'

export const ACTIVE_STATES: readonly VideoState[] = ['requested', 'dispatched', 'started']
export const TERMINAL_STATES: readonly VideoState[] = ['ended', 'stopped', 'error']

/** refresh_video を渡す間隔（仕様: 30 秒ごと。拠点は 60 秒で止める）。 */
export const REFRESH_EVERY_MS = 30_000
/** 画面の生存がこれだけ途切れたら止める。画面は 10 秒ごとに知らせる。 */
export const VIEWER_STALE_MS = 25_000
/** 画面が生存を知らせる間隔。 */
export const VIEWER_KEEPALIVE_MS = 10_000

/** 録画再生 1 セッションの上限（§5.3.1）。 */
export const VOD_MAX_SPAN_MS = 4 * 60 * 60 * 1000
/** `to` を省いたときの長さ（§5.3.1）。 */
export const VOD_DEFAULT_SPAN_MS = 60 * 60 * 1000

/** 輪番の置き場の数（ライブ 8・録画再生 16。§5.2.1・§5.3.1）。 */
export function slotCount(kind: VideoKind): number {
  return kind === 'hls_vod' ? 16 : 8
}

export function isActive(state: VideoState): boolean {
  return ACTIVE_STATES.includes(state)
}

/** commands/next が判断に使う列だけ。 */
export interface DispatchRow {
  id: string
  kind: VideoKind
  state: VideoState
  viewer_seen_at: string
  stop_requested_at: string | null
  refresh_sent_at: string | null
  dispatched_at: string | null
}

export type VideoAction<R extends DispatchRow = DispatchRow> =
  /** 拠点へ stop_video を渡す（開始の指示を渡し済み） */
  | { type: 'stop'; row: R }
  /** まだ拠点へ何も渡していない — 指示は出さずにクラウド側だけで終える */
  | { type: 'drop'; row: R }
  | { type: 'start'; row: R }
  | { type: 'refresh'; row: R }

function ms(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Number.NaN
}

/** 画面が閉じられた・生存が途切れたので止めたいか。 */
export function wantsStop(row: DispatchRow, nowMs: number): boolean {
  if (row.stop_requested_at) return true
  return nowMs - ms(row.viewer_seen_at) > VIEWER_STALE_MS
}

/**
 * この拠点へ次に渡す 1 件を選ぶ。無ければ null。
 * 順番は「止める → 始める → 合図」。止めるのを先にするのは、拠点の同時視聴の枠を
 * 空けてから次の開始を渡すため（上限 4 本で、閉じてすぐ別のカメラを開く操作を通す）。
 */
export function pickVideoAction<R extends DispatchRow>(rows: readonly R[], nowMs: number): VideoAction<R> | null {
  const active = rows.filter((r) => isActive(r.state))
  for (const r of active) {
    if (!wantsStop(r, nowMs)) continue
    return r.state === 'requested' ? { type: 'drop', row: r } : { type: 'stop', row: r }
  }
  const start = active
    .filter((r) => r.state === 'requested')
    .sort((a, b) => ms(a.viewer_seen_at) - ms(b.viewer_seen_at))[0]
  if (start) return { type: 'start', row: start }
  for (const r of active) {
    if (r.state === 'requested') continue
    const last = ms(r.refresh_sent_at ?? r.dispatched_at)
    if (!(nowMs - last < REFRESH_EVERY_MS)) return { type: 'refresh', row: r }
  }
  return null
}

/**
 * HLS の配信のパス（index.m3u8 / init.mp4 / s/<seq>.<ext>）を置き場の名前に読み替える。
 * `s/<seq>` は置き場 `seq % 置き場の数`（§5.2.2）。読めなければ null。
 */
export type HlsObject =
  | { kind: 'playlist' }
  | { kind: 'init' }
  | { kind: 'segment'; slot: number; ext: 'ts' | 'm4s' }

export function parseHlsPath(parts: readonly string[], videoKind: VideoKind): HlsObject | null {
  if (parts.length === 1 && parts[0] === 'index.m3u8') return { kind: 'playlist' }
  if (parts.length === 1 && parts[0] === 'init.mp4') return { kind: 'init' }
  if (parts.length === 2 && parts[0] === 's') {
    const m = /^(\d{1,15})\.(ts|m4s)$/.exec(parts[1])
    if (!m) return null
    const seq = Number(m[1])
    return { kind: 'segment', slot: seq % slotCount(videoKind), ext: m[2] as 'ts' | 'm4s' }
  }
  return null
}

/** §5.1 の error の値。 */
export type VideoError =
  | 'busy' | 'bandwidth' | 'codec_unsupported'
  | 'unknown_camera' | 'no_recording' | 'offline' | 'internal'

const FALLBACK_TO_JPEG = new Set(['busy', 'bandwidth', 'codec_unsupported'])

/**
 * 静止画ライブへ戻すべき失敗か（§5.1: busy / bandwidth / codec_unsupported）。
 * それ以外はエラーとして見せる（静止画でも見られない可能性が高い）。
 */
export function shouldFallbackToJpeg(error: string | null | undefined): boolean {
  return !!error && FALLBACK_TO_JPEG.has(error)
}

/** 画面に出す失敗の説明。値そのものは出さず、現場向けの文にする。 */
export function describeVideoError(error: string | null | undefined): string {
  switch (error) {
    case 'busy': return '拠点の同時視聴の上限に達しています'
    case 'bandwidth': return '拠点の上り回線の上限に達しています'
    case 'codec_unsupported': return 'このカメラの映像はブラウザで再生できる形式で送れません'
    case 'unknown_camera': return '拠点にこのカメラが見つかりません'
    case 'no_recording': return '指定の時間帯に録画がありません'
    case 'offline': return 'カメラの映像が届いていません'
    case 'timeout': return '拠点から応答がありません'
    case 'stopped': return '拠点からの送信が止まりました'
    default: return '映像を送れませんでした'
  }
}

/** video/status と commands/result から受ける error を §5.1 の値に丸める（知らない値は internal）。 */
const KNOWN_ERRORS = new Set<string>([
  'busy', 'bandwidth', 'codec_unsupported', 'unknown_camera', 'no_recording', 'offline', 'internal',
])
export function normalizeVideoError(error: string | null | undefined): VideoError {
  return error && KNOWN_ERRORS.has(error) ? (error as VideoError) : 'internal'
}

/**
 * 録画再生の範囲を整える。to を省けば from から 60 分、4 時間で切る。
 * 未来は拠点側で切るのでここでは見ない。不正なら null。
 */
export function normalizeVodRange(fromIso: string, toIso?: string | null): { from: Date; to: Date } | null {
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime())) return null
  let to = toIso ? new Date(toIso) : new Date(from.getTime() + VOD_DEFAULT_SPAN_MS)
  if (Number.isNaN(to.getTime()) || to.getTime() <= from.getTime()) return null
  if (to.getTime() - from.getTime() > VOD_MAX_SPAN_MS) to = new Date(from.getTime() + VOD_MAX_SPAN_MS)
  return { from, to }
}
