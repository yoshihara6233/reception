/**
 * F46.13: 認証情報 Resolver
 *
 * stores.nvr_credentials_ref (uuid) から実際の username/password を引いてくる。
 *
 * Phase 0 では以下の順でフォールバック:
 *   1. 環境変数 NVR_CRED_<REF> (JSON 形式)
 *   2. ローカル secrets.json (開発用)
 *   3. (将来) Supabase Vault — Phase 2 で実装
 *
 * セキュリティ:
 *   - 解決した credentials は console.log に出さない
 *   - toString() / inspect() でも password を隠す
 *   - 解決済 credentials は短命に保つ (call ごとに解決し直す or キャッシュ TTL 短)
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface NvrCredentials {
  username: string
  password: string
}

/**
 * password を toString や JSON.stringify で隠すラッパ。
 * 実値は private symbol で保持する。
 */
const PASSWORD_SYMBOL = Symbol('password')

export class SafeCredentials implements NvrCredentials {
  public readonly username: string
  private readonly [PASSWORD_SYMBOL]: string

  constructor(username: string, password: string) {
    this.username = username
    this[PASSWORD_SYMBOL] = password
  }

  /** 実際の password を取り出す (adapter 内でのみ使用) */
  get password(): string {
    return this[PASSWORD_SYMBOL]
  }

  /** ログに出ても安全な表現 */
  toString(): string {
    return `[NvrCredentials user=${this.username} password=***]`
  }

  toJSON(): object {
    return { username: this.username, password: '***' }
  }
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * credentials_ref から NvrCredentials を解決する。
 *
 * @param ref - stores.nvr_credentials_ref の uuid
 * @throws Error if credentials not found
 */
export async function resolveCredentials(
  ref: string | null | undefined,
): Promise<NvrCredentials> {
  if (!ref) {
    throw new Error('Credentials reference is null or empty')
  }

  // 1. 環境変数経由 (NVR_CRED_<UPPERCASED_REF> = '{"username":"x","password":"y"}')
  const envKey = `NVR_CRED_${ref.toUpperCase().replace(/-/g, '_')}`
  const envValue = process.env[envKey]
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue) as { username: string; password: string }
      if (parsed.username && parsed.password) {
        return new SafeCredentials(parsed.username, parsed.password)
      }
    } catch {
      // fall through to next source
    }
  }

  // 2. ローカル secrets.json (開発用)
  const localPath = join(process.cwd(), 'secrets.json')
  if (existsSync(localPath)) {
    try {
      const file = JSON.parse(readFileSync(localPath, 'utf-8')) as Record<
        string,
        { username: string; password: string }
      >
      const entry = file[ref]
      if (entry?.username && entry?.password) {
        return new SafeCredentials(entry.username, entry.password)
      }
    } catch {
      // fall through
    }
  }

  // 3. Supabase Vault — Phase 2 で実装予定
  // const { data } = await supabase.rpc('get_vault_secret', { ref })
  // if (data) return new SafeCredentials(data.username, data.password)

  throw new Error(`Credentials not found for ref: ${ref}`)
}

/**
 * 簡易キャッシュ (TTL 5 分)。Vault 呼び出しコスト削減用。
 * Phase 2 で Vault 実装時に有効化。
 */
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { creds: NvrCredentials; expiresAt: number }>()

export async function resolveCredentialsCached(
  ref: string,
): Promise<NvrCredentials> {
  const hit = cache.get(ref)
  if (hit && hit.expiresAt > Date.now()) {
    return hit.creds
  }
  const creds = await resolveCredentials(ref)
  cache.set(ref, { creds, expiresAt: Date.now() + CACHE_TTL_MS })
  return creds
}

export function clearCredentialsCache(ref?: string): void {
  if (ref) cache.delete(ref)
  else     cache.clear()
}
