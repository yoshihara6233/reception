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
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto'

const ENC_PREFIX = 'enc:v1:'
const ENC_V2_PREFIX = 'enc:v2:'
const PLAIN_PREFIX = 'plain:'
const TAG_LEN = 16   // GCM 認証タグ長(bytes)。短縮タグ偽造を防ぐため明示。

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
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, ct, tag]).toString('base64')
}

// ─────────────────────────────────────────────────────────────────────────────
// enc:v2 — エッジごとの鍵 (2026-10-29・自主診断 ASVS 11.1.1・11.2.2・13.3.2)
//
// v1 は 1 本の鍵 (SECRETS_ENC_KEY) をクラウドと全エッジが同じ値で持っていた。1 台のエッジから
// 漏れると、全テナントの録画機のパスワードを復号できた。鍵の ID も無く、入れ替えられなかった。
//
// v2 では:
//   - 元の鍵 (マスタ) はクラウド (Vercel) だけが持つ。複数持てて ID で見分ける (入れ替えのため)。
//       SECRETS_ENC_KEYS = "k2:<hex か base64>,k1:<…>"   先頭が今の鍵。無ければ SECRETS_ENC_KEY を k1 とみなす
//   - エッジの鍵 = HKDF-SHA256(マスタ, salt=エッジの ID, info="gvms-edge-secret-v2")。
//     エッジには自分の鍵だけを初回の受け口 (bootstrap) で渡し、メモリにだけ置く。
//   - 暗号文にエッジの ID を AAD として縛る (別のエッジの行に写しても解けない)。
//   - 形式: `enc:v2:<鍵の ID>:<base64(iv(12) | ciphertext | authTag(16))>`
//
// 切り替えの順序: v2 で書くのは SECRETS_ENC_KEYS を設定してから (古いエッジは v2 を読めない)。
//   1) この版を入れる (bootstrap がエッジの鍵を配り始める・書き込みは v1 のまま)
//   2) エッジのエージェントを v2 を読める版へ上げる
//   3) クラウドに SECRETS_ENC_KEYS=k1:<今の SECRETS_ENC_KEY> を設定 → 以後 v2 で書く
//   4) /api/admin/secrets/rewrap で既存の行を包み直す → 5) エッジの SECRETS_ENC_KEY を外す
// ─────────────────────────────────────────────────────────────────────────────

const HKDF_INFO = 'gvms-edge-secret-v2'

function decodeKey(raw: string, name: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes (AES-256)`)
  return key
}

interface Keyring { current: string; keys: Map<string, Buffer> }

/** クラウドのマスタ鍵の束。無ければ null。 */
function loadMasterKeyring(): Keyring | null {
  const multi = process.env.SECRETS_ENC_KEYS
  if (multi) {
    const keys = new Map<string, Buffer>()
    let current = ''
    for (const part of multi.split(',').map((x) => x.trim()).filter(Boolean)) {
      const i = part.indexOf(':')
      if (i <= 0) throw new Error('SECRETS_ENC_KEYS must be "kid:key,kid:key"')
      const kid = part.slice(0, i)
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(kid)) throw new Error(`invalid key id in SECRETS_ENC_KEYS: ${kid}`)
      keys.set(kid, decodeKey(part.slice(i + 1), `SECRETS_ENC_KEYS[${kid}]`))
      if (!current) current = kid
    }
    return current ? { current, keys } : null
  }
  const k1 = loadKey()
  return k1 ? { current: 'k1', keys: new Map([['k1', k1]]) } : null
}

/** マスタ鍵とエッジの ID から、そのエッジの鍵を作る。 */
export function deriveEdgeKey(master: Buffer, edgeId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(edgeId, 'utf8'), HKDF_INFO, 32))
}

/** エッジの側で持つ、自分の鍵の束 (bootstrap で受け取る)。 */
let edgeRing: { edgeId: string; keys: Map<string, Buffer> } | null = null

/** エッジ: bootstrap で受け取った自分の鍵 ({鍵の ID: base64}) を置く。 */
export function setEdgeSecretKeys(edgeId: string, keys: Record<string, string>): void {
  const m = new Map<string, Buffer>()
  for (const [kid, b64] of Object.entries(keys)) m.set(kid, decodeKey(b64, `edge key ${kid}`))
  edgeRing = { edgeId, keys: m }
}

/** 試験のため: エッジの鍵の束を消す。 */
export function clearEdgeSecretKeys(): void { edgeRing = null }

/** クラウド: そのエッジへ渡す鍵の束 ({鍵の ID: base64})。マスタが無ければ null。 */
export function edgeSecretKeysFor(edgeId: string): Record<string, string> | null {
  const ring = loadMasterKeyring()
  if (!ring) return null
  const out: Record<string, string> = {}
  for (const [kid, master] of ring.keys) out[kid] = deriveEdgeKey(master, edgeId).toString('base64')
  return out
}

function aadFor(edgeId: string): Buffer {
  return Buffer.from(`gvms-edge-secret:${edgeId}`, 'utf8')
}

/** クラウド: そのエッジの録画機の秘密を v2 で暗号化する。SECRETS_ENC_KEYS が無ければ v1 (無停止配備のため)。 */
export function encryptSecretForEdge(plain: string, edgeId: string): string {
  if (!process.env.SECRETS_ENC_KEYS) return encryptSecret(plain)   // 切り替え前は v1 (古いエッジが読める形)
  const ring = loadMasterKeyring()
  if (!ring) return PLAIN_PREFIX + plain
  const key = deriveEdgeKey(ring.keys.get(ring.current)!, edgeId)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  cipher.setAAD(aadFor(edgeId))
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${ENC_V2_PREFIX}${ring.current}:` + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64')
}

/** 暗号化し直す必要があるか (v2 でない・今の鍵でない)。SECRETS_ENC_KEYS が無ければ false。 */
export function needsRewrap(stored: string | null | undefined): boolean {
  if (!stored) return false
  if (!process.env.SECRETS_ENC_KEYS) return false   // 切り替え前は包み直さない
  const ring = loadMasterKeyring()
  if (!ring) return false
  if (!stored.startsWith(ENC_V2_PREFIX)) return true
  return stored.slice(ENC_V2_PREFIX.length).split(':', 1)[0] !== ring.current
}

function decryptV2(stored: string, edgeId: string | undefined): string {
  if (!edgeId) throw new Error('enc:v2 needs the edge id to decrypt')
  const rest = stored.slice(ENC_V2_PREFIX.length)
  const i = rest.indexOf(':')
  if (i <= 0) throw new Error('invalid enc:v2 value')
  const kid = rest.slice(0, i)
  let key: Buffer | undefined
  if (edgeRing && edgeRing.edgeId === edgeId) key = edgeRing.keys.get(kid)
  if (!key) {
    const master = loadMasterKeyring()?.keys.get(kid)
    if (master) key = deriveEdgeKey(master, edgeId)
  }
  if (!key) throw new Error(`no key for enc:v2 (kid=${kid}) — bootstrap has not delivered the edge key yet`)
  const buf = Buffer.from(rest.slice(i + 1), 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ct  = buf.subarray(12, buf.length - TAG_LEN)
  if (tag.length !== TAG_LEN) throw new Error('invalid GCM auth tag length')
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  decipher.setAAD(aadFor(edgeId))
  decipher.setAuthTag(tag)
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8')
}

/**
 * 保存値 → 平文。`enc:v2`=エッジの鍵で復号 (edgeId が要る) / `enc:v1`=復号 / `plain:`=剥がす /
 * それ以外=そのまま。
 */
export function decryptSecret(stored: string, edgeId?: string): string {
  if (stored.startsWith(ENC_V2_PREFIX)) return decryptV2(stored, edgeId)
  if (stored.startsWith(ENC_PREFIX)) {
    // SECRETS_ENC_KEYS へ移ったあとは、その k1 (= 以前の SECRETS_ENC_KEY) で v1 を解く
    const key = loadKey() ?? loadMasterKeyring()?.keys.get('k1') ?? null
    if (!key) throw new Error('SECRETS_ENC_KEY not set but value is enc:v1 (cannot decrypt)')
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
    const iv  = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - TAG_LEN)
    const ct  = buf.subarray(12, buf.length - TAG_LEN)
    // authTagLength を明示し、短縮タグ偽造(GCM truncation)を拒否する。
    if (tag.length !== TAG_LEN) throw new Error('invalid GCM auth tag length')
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
    decipher.setAuthTag(tag)
    return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8')
  }
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  return stored
}
