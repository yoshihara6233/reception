/**
 * 手荷物検査 iPadキオスクの店舗別PIN — ハッシュ・照合・ロックアウト・署名セッション。
 *
 * - PIN は scrypt でハッシュ化して保存（平文は保持しない）。照合は定数時間比較。
 * - オンライン総当り対策: 5回失敗で15分ロック（状態遷移は純関数 nextLockState）。
 * - 一致時は「キオスク限定・店舗限定」の署名トークンを httpOnly cookie で発行する。
 *   署名鍵は SUPABASE_SERVICE_ROLE_KEY から導出（新規 env 不要・サーバ専用）。
 *
 * すべてサーバ専用（node:crypto）。クライアントへ鍵・ハッシュを渡さない。
 */
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'

export const KIOSK_COOKIE = 'bgk_session'
export const MAX_PIN_ATTEMPTS = 5
export const LOCK_MINUTES = 15
export const SESSION_HOURS = 12
const SCRYPT_KEYLEN = 32

/** 6桁の数字のみ許可（先頭ゼロ可）。 */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin)
}

// ── ハッシュ（scrypt: base64(salt)$base64(dk)） ───────────────────────────────

export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const dk = scryptSync(pin, salt, SCRYPT_KEYLEN)
  return `${salt.toString('base64')}$${dk.toString('base64')}`
}

export function verifyPinHash(pin: string, stored: string): boolean {
  const [saltB64, dkB64] = stored.split('$')
  if (!saltB64 || !dkB64) return false
  let expected: Buffer
  try {
    expected = Buffer.from(dkB64, 'base64')
  } catch {
    return false
  }
  const actual = scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// ── ロックアウト状態遷移（純関数・テスト対象） ────────────────────────────────

export interface PinLockState {
  failedAttempts: number
  lockedUntil: Date | null
}

/** ロック中か（now 時点）。 */
export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime()
}

/**
 * 照合結果からロック状態を更新する。
 *   - 成功 → 失敗回数リセット・ロック解除
 *   - 失敗 → 失敗回数+1、MAX 到達で now+LOCK 分ロック（到達後はカウンタをリセット）
 */
export function nextLockState(current: PinLockState, success: boolean, now: Date): PinLockState {
  if (success) return { failedAttempts: 0, lockedUntil: null }
  const attempts = current.failedAttempts + 1
  if (attempts >= MAX_PIN_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
  }
  return { failedAttempts: attempts, lockedUntil: current.lockedUntil }
}

// ── 署名セッション（HMAC-SHA256・payload.sig / base64url） ─────────────────────

function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  // サービス鍵を直接使わず、用途固定の派生鍵にする。
  return createHmac('sha256', secret).update('baggage-kiosk-session-v1').digest()
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** storeId 限定・expMs 失効の署名トークンを作る。 */
export function signKioskSession(storeId: string, now: Date): { token: string; maxAgeSec: number } {
  const expMs = now.getTime() + SESSION_HOURS * 3_600_000
  const payload = b64url(Buffer.from(JSON.stringify({ s: storeId, e: expMs })))
  const sig = b64url(createHmac('sha256', signingKey()).update(payload).digest())
  return { token: `${payload}.${sig}`, maxAgeSec: SESSION_HOURS * 3600 }
}

/**
 * トークンが正しく署名され未失効なら、その対象 storeId を返す（無効なら null）。
 * storeId を先に知らずに「正規のキオスクセッションか」を判定したい経路（存在オラクル
 * 防止のプレゲート）で使う。
 */
export function kioskSessionStoreId(token: string | undefined, now: Date): string | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', signingKey()).update(payload).digest()
  let given: Buffer
  try {
    given = b64urlToBuf(sig)
  } catch {
    return null
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const { s, e } = JSON.parse(b64urlToBuf(payload).toString('utf8')) as { s?: string; e?: number }
    if (typeof s === 'string' && typeof e === 'number' && e > now.getTime()) return s
    return null
  } catch {
    return null
  }
}

/** トークンが storeId 向けに有効（署名一致・未失効・店舗一致）か。 */
export function verifyKioskSession(token: string | undefined, storeId: string, now: Date): boolean {
  return kioskSessionStoreId(token, now) === storeId
}
