/**
 * エッジ用APIトークン — 純ロジック（T2）
 *
 * 方針:
 *   - トークンは平文を保存しない。SHA-256 ハッシュのみ DB(edge_api_tokens.token_hash)に保存。
 *     平文は発行API応答で1度だけ返す（Intereco enrollment_tokens パターン流用）。
 *   - 照合はハッシュ一致で行う（token_hash に UNIQUE インデックス）。
 *   - edge API はバージョンヘッダを持ち、後方互換ポリシーで旧エッジの許容期間を定義する
 *     （reception API 変更が Intereco OTA と密結合しないため）。
 *
 * ここは I/O を持たない純関数のみ（DB アクセスは auth.ts）。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** エッジがトークンを載せるヘッダ。 */
export const EDGE_TOKEN_HEADER = 'x-edge-token'
/** エッジが自分の API バージョンを申告するヘッダ。 */
export const EDGE_VERSION_HEADER = 'x-edge-api-version'

/** 発行される平文トークンの接頭辞（ログ等での識別・取り違え防止）。 */
export const EDGE_TOKEN_PREFIX = 'bgedge_'

/** 現行の edge API バージョン。破壊的変更時にインクリメントする。 */
export const EDGE_API_VERSION = 1
/** サーバが受け入れる最小エッジバージョン（これ未満は 426 で更新を促す）。 */
export const MIN_SUPPORTED_EDGE_VERSION = 1

/** 平文トークンを生成する（256bit エントロピー・URLセーフ）。 */
export function generateEdgeToken(): string {
  return EDGE_TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

/** 平文トークンの SHA-256 ハッシュ（16進）。DB 保存・照合キー。 */
export function hashEdgeToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

/**
 * 2つのハッシュ(hex)を時間一定で比較する。
 * 照合は UNIQUE インデックスのハッシュ検索で行うため通常は不要だが、
 * 直接比較する経路（例: 環境変数の共有トークン）用に提供する。
 */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

export interface VersionCheck {
  ok: boolean
  /** ok=false のとき、ルートが返すべき HTTP ステータス。 */
  status: number
  reason: string
  /** パースできたバージョン（未指定/不正なら null）。 */
  version: number | null
}

/**
 * エッジの申告バージョンを検証する（後方互換ポリシー）。
 *   - 未指定/非数値 → 400（ヘッダ必須）
 *   - MIN_SUPPORTED 未満 → 426 Upgrade Required（旧エッジは更新を促す）
 *   - 現行より新しい → 許容（サーバが後追いで上げる想定・ログのみ）
 *   - 範囲内 → OK
 */
export function checkEdgeVersion(headerValue: string | null | undefined): VersionCheck {
  if (headerValue == null || headerValue.trim() === '') {
    return { ok: false, status: 400, reason: 'missing edge api version header', version: null }
  }
  const v = Number(headerValue)
  if (!Number.isInteger(v) || v <= 0) {
    return { ok: false, status: 400, reason: 'malformed edge api version', version: null }
  }
  if (v < MIN_SUPPORTED_EDGE_VERSION) {
    return { ok: false, status: 426, reason: `edge version ${v} below minimum ${MIN_SUPPORTED_EDGE_VERSION}`, version: v }
  }
  return { ok: true, status: 200, reason: 'ok', version: v }
}
