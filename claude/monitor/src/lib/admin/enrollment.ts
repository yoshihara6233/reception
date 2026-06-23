/**
 * エッジ自己登録トークンのユーティリティ（DR2）。
 *
 * - 生トークンはクライアント/エッジに1度だけ返し、DB には SHA-256 ハッシュのみ保存。
 * - 検証は token_hash 一致 + 単一使用(used_at IS NULL) + 未失効(expires_at>now) +
 *   tenant/store はトークン行由来（クライアント入力に依存しない＝詐称不可）。
 */
import { randomBytes, createHash } from 'node:crypto'

/** 既定 TTL = 24 時間。 */
export const ENROLL_TTL_MS = 24 * 60 * 60 * 1000

/** URL/QR に載せやすい生トークン（32 バイト = 64 hex）。 */
export function generateEnrollToken(): string {
  return randomBytes(32).toString('hex')
}

/** 生トークン → SHA-256 hex（DB 保存・照合用）。 */
export function hashEnrollToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** now()+TTL の ISO 文字列（発行時の expires_at 用）。 */
export function enrollExpiryIso(now: number = Date.now()): string {
  return new Date(now + ENROLL_TTL_MS).toISOString()
}
