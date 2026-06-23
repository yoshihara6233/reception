/**
 * 秘密情報のアプリ層 Vault化（AES-256-GCM 封筒暗号）。
 *
 * カメラ/VOD パスワードを DB に平文で持たないための共通コーデック。monitor が
 * 書込時に暗号化し、edge が読込時に復号する。復号鍵 `SECRETS_ENC_KEY` は env にのみ
 * 置く（DB には鍵を持たない）ので、DBダンプ単体では平文を復元できない。
 *
 * 保存形式: `enc:v1:<base64(iv(12) | ciphertext | authTag(16))>`
 * 後方互換: `plain:<pw>`（旧運用）は読める／プレフィクス無しの生値もそのまま返す。
 *
 * ⚠ ロールアウト順: **beelink と Vercel の両方に同じ `SECRETS_ENC_KEY` を設定してから**
 *   有効化すること。片方だけだと enc 値を相手が復号できない。鍵未設定時は encryptSecret は
 *   `plain:` にフォールバックする（鍵配備前でもアプリを壊さない）。
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ENC_PREFIX = 'enc:v1:'
const PLAIN_PREFIX = 'plain:'

/** env の鍵を 32byte Buffer に。未設定は null。hex(64) か base64 を受理。 */
function loadKey(): Buffer | null {
  const raw = process.env.SECRETS_ENC_KEY
  if (!raw) return null
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('SECRETS_ENC_KEY must decode to 32 bytes (AES-256): use 64 hex chars or base64 of 32 bytes')
  }
  return key
}

/** 平文 → `enc:v1:…`。鍵未設定時は `plain:` にフォールバック（無停止配備のため）。 */
export function encryptSecret(plain: string): string {
  const key = loadKey()
  if (!key) return PLAIN_PREFIX + plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, ct, tag]).toString('base64')
}

/** 保存値 → 平文。`enc:v1`=復号 / `plain:`=剥がす / それ以外=そのまま。 */
export function decryptSecret(stored: string): string {
  if (stored.startsWith(ENC_PREFIX)) {
    const key = loadKey()
    if (!key) throw new Error('SECRETS_ENC_KEY not set but value is enc:v1 (cannot decrypt)')
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
    const iv  = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ct  = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8')
  }
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  return stored
}
