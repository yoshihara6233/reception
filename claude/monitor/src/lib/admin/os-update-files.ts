/**
 * OS 更新ファイル（G・VMS の internal/osfile・接続仕様 §14）の読み取り。
 *
 * 形は `nvmsosu1.<本文 (base64url の JSON)>.<署名 (base64url)>` の 1 行。
 * クラウドは**中身を作り変えずに預かってそのまま配る**（1 文字でも変えると拠点で署名が合わない）。
 * ここで読むのは、運営の画面に「何を届けるのか」を出すためと、貼り間違いを登録の時点で断るため。
 * 署名を最終的に確かめるのは拠点（埋め込みの公開鍵）。
 */
import { createPublicKey, verify } from 'node:crypto'

export const OS_UPDATE_PREFIX = 'nvmsosu1'
/** 受け口が返せる大きさの上限（§14.1）。 */
export const OS_UPDATE_MAX_SIGNED = 64 * 1024
/** 拠点の名乗り（heartbeat の capabilities）。 */
export const CAP_OS_UPDATE = 'os_update'

export interface OsUpdatePackage { name: string; at_least: string }
export interface OsUpdateBody {
  id: string
  title: string
  advisory: string | null
  cve: string | null
  issued_at: string | null
  packages: OsUpdatePackage[]
  reboot: boolean
}

export type OsUpdateParseError =
  | 'too_large' | 'bad_format' | 'bad_body' | 'bad_id' | 'no_title' | 'bad_packages' | 'bad_signature'

export type OsUpdateParsed =
  | { ok: true; signed: string; body: OsUpdateBody; signatureChecked: boolean }
  | { ok: false; error: OsUpdateParseError }

// G・VMS 側 (internal/osfile) の検査と同じ式
const ID_RE = /^[A-Za-z0-9-]{1,48}$/
const PKG_RE = /^[a-z0-9][a-z0-9._+-]{0,63}$/
const VER_RE = /^[0-9A-Za-z._:~+-]{1,64}$/
const B64URL_RE = /^[A-Za-z0-9_-]+$/

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** Ed25519 の生の公開鍵 (32 バイト) を node の鍵にする。 */
function ed25519Key(rawB64: string) {
  const raw = Buffer.from(rawB64, 'base64')
  if (raw.length !== 32) return null
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  try { return createPublicKey({ key: spki, format: 'der', type: 'spki' }) } catch { return null }
}

/**
 * 1 行を読む。pubkeys（base64・カンマか空白で区切る・環境変数 NVMS_UPDATE_PUBKEY）があれば署名も確かめる。
 * 無ければ形と中身だけを確かめる（signatureChecked=false）。
 */
export function parseOsUpdateSigned(input: string, pubkeys?: string | null): OsUpdateParsed {
  const signed = input.trim()
  if (Buffer.byteLength(signed, 'utf8') > OS_UPDATE_MAX_SIGNED) return { ok: false, error: 'too_large' }
  const parts = signed.split('.')
  if (parts.length !== 3 || parts[0] !== OS_UPDATE_PREFIX || !B64URL_RE.test(parts[1]) || !B64URL_RE.test(parts[2])) {
    return { ok: false, error: 'bad_format' }
  }
  const bodyBytes = Buffer.from(parts[1], 'base64url')
  let raw: Record<string, unknown>
  try {
    const j: unknown = JSON.parse(bodyBytes.toString('utf8'))
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'bad_body' }
    raw = j as Record<string, unknown>
  } catch {
    return { ok: false, error: 'bad_body' }
  }
  const id = str(raw.id)
  if (!id || !ID_RE.test(id)) return { ok: false, error: 'bad_id' }
  const title = str(raw.title)
  if (!title) return { ok: false, error: 'no_title' }
  if (!Array.isArray(raw.packages) || raw.packages.length === 0 || raw.packages.length > 16) {
    return { ok: false, error: 'bad_packages' }
  }
  const packages: OsUpdatePackage[] = []
  for (const p of raw.packages as unknown[]) {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const name = str(o.name)
    const atLeast = str(o.at_least)
    if (!name || !atLeast || !PKG_RE.test(name) || !VER_RE.test(atLeast) || packages.some((x) => x.name === name)) {
      return { ok: false, error: 'bad_packages' }
    }
    packages.push({ name, at_least: atLeast })
  }

  const keys = (pubkeys ?? '').split(/[\s,]+/).filter(Boolean).map(ed25519Key).filter((k) => k !== null)
  let signatureChecked = false
  if (keys.length > 0) {
    // 署名の対象は「接頭辞 + 改行 + 本文」（internal/osfile の signedBytes）
    const msg = Buffer.concat([Buffer.from(OS_UPDATE_PREFIX + '\n', 'utf8'), bodyBytes])
    const sig = Buffer.from(parts[2], 'base64url')
    if (!keys.some((k) => { try { return verify(null, msg, k, sig) } catch { return false } })) {
      return { ok: false, error: 'bad_signature' }
    }
    signatureChecked = true
  }

  return {
    ok: true,
    signed,
    signatureChecked,
    body: {
      id, title, packages,
      advisory: str(raw.advisory),
      cve: str(raw.cve),
      issued_at: str(raw.issued_at),
      reboot: raw.reboot === true,
    },
  }
}
