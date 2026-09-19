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

/**
 * 短縮コード（QR が主・手入力の控え・ENROLLMENT_SPEC §7 ②）。
 *
 * 曖昧な文字を除いた 32 文字集合（Crockford 風・I/L/O/U と 0/1 を除く）から
 * 10 文字＝約 50 bit。`XXXXX-XXXXX` にグループ化して読みやすくする。
 * 単一使用・24h TTL・拠点束縛・レート制限との併用が前提の強度。
 */
const SHORT_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ' // 30 文字（0O1ILU 除外）
const SHORT_LEN = 10

export function generateShortCode(): string {
  const raw = randomBytes(SHORT_LEN)
  let out = ''
  for (let i = 0; i < SHORT_LEN; i++) {
    out += SHORT_ALPHABET[raw[i] % SHORT_ALPHABET.length]
    if (i === 4) out += '-'
  }
  return out
}

/**
 * 短縮コード → SHA-256 hex。入力の揺れ（小文字・空白・ハイフン）を正規化してから
 * ハッシュするので、手入力の表記ぶれを吸収する。QR は生コードをそのまま載せる。
 */
export function hashShortCode(raw: string): string {
  const normalized = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return createHash('sha256').update('nvmscode:' + normalized).digest('hex')
}

/** now()+TTL の ISO 文字列（発行時の expires_at 用）。 */
export function enrollExpiryIso(now: number = Date.now()): string {
  return new Date(now + ENROLL_TTL_MS).toISOString()
}
