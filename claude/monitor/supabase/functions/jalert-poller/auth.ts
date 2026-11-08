/**
 * jalert-poller の呼び出しの認証と、DB に使う鍵の選び方（2026-11-09・ASVS 13.3.2）。
 *
 * 以前は Supabase の関数の入口（verify_jwt）に任せ、呼び出し側（pg_cron の
 * invoke_jalert_poller）は Vault の service_role の旧式の鍵（JWT）を Bearer で送っていた。
 * 関数の中も、Supabase が自動で渡す旧式の service_role の鍵で DB を操作していた。
 * これでは旧式の鍵を止められない（止めると J アラートの取り込みが止まる）ので、
 *
 *   - 呼び出しは専用の合言葉 `JALERT_INVOKE_SECRET` だけで受ける（関数の入口の JWT の確かめは外す）
 *   - DB の操作は専用の秘密の鍵（Supabase の新しい形式の secret キー・名前 `jalert_poller`）で行う。
 *     Supabase が関数に自動で渡す `SUPABASE_SECRET_KEYS`（名前 → 鍵の JSON）から名前で引くので、
 *     鍵の値を関数の設定に写さなくてよい。`JALERT_DB_KEY` を置けばそちらが先
 *
 * に分けた。切り替えの間だけ `JALERT_ALLOW_LEGACY_INVOKE=1` で旧式の鍵も受ける
 * （手順は docs/security-keys.md §5）。旧式の鍵を止める前に、この設定を外す。
 *
 * Deno と Node（vitest）の両方で動くように、外の部品に頼らない。
 */

/** `Authorization: Bearer <token>` から token を取り出す。形が違えば null。 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return m ? m[1] : null
}

/** 長さが同じなら、中身によらず同じ手数で比べる（合言葉の当て推量に時間の差を与えない）。 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

export interface JalertEnv {
  /** 呼び出しの合言葉（Vault の jalert_invoke_secret と同じ値） */
  JALERT_INVOKE_SECRET?: string
  /** DB の操作に使う新しい形式の秘密の鍵（sb_secret_…）。置けば SUPABASE_SECRET_KEYS より先 */
  JALERT_DB_KEY?: string
  /** SUPABASE_SECRET_KEYS から引く鍵の名前（既定 jalert_poller） */
  JALERT_SECRET_KEY_NAME?: string
  /** Supabase が自動で渡す新しい形式の秘密の鍵の一覧（名前 → 鍵の JSON） */
  SUPABASE_SECRET_KEYS?: string
  /** '1' のときだけ、切り替えの間の逃げ道として旧式の鍵を受ける・使う */
  JALERT_ALLOW_LEGACY_INVOKE?: string
  /** Supabase が自動で渡す旧式の service_role の鍵 */
  SUPABASE_SERVICE_ROLE_KEY?: string
}

const nonEmpty = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== ''

function legacyAllowed(env: JalertEnv): boolean {
  return env.JALERT_ALLOW_LEGACY_INVOKE?.trim() === '1'
}

/**
 * 呼び出しを受けてよいか。受ける値が 1 つも設定されていなければ、だれも通さない（フェイルクローズ）。
 */
export function isAuthorizedInvoke(header: string | null | undefined, env: JalertEnv): boolean {
  const token = bearerToken(header)
  if (!token) return false
  const accepted: string[] = []
  if (nonEmpty(env.JALERT_INVOKE_SECRET)) accepted.push(env.JALERT_INVOKE_SECRET.trim())
  if (legacyAllowed(env) && nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY)) {
    accepted.push(env.SUPABASE_SERVICE_ROLE_KEY.trim())
  }
  // 早く抜けずに全部と比べる
  let ok = false
  for (const v of accepted) ok = constantTimeEqual(token, v) || ok
  return ok
}

export const DEFAULT_SECRET_KEY_NAME = 'jalert_poller'

/** SUPABASE_SECRET_KEYS（名前 → 鍵の JSON）から名前で引く。形が違えば null（値は投げない・ログに出さない）。 */
export function secretKeyByName(raw: string | undefined, name: string): string | null {
  if (!nonEmpty(raw)) return null
  try {
    const obj: unknown = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const v = (obj as Record<string, unknown>)[name]
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
    }
  } catch {
    // 形が違う
  }
  return null
}

/** DB の操作に使う鍵。専用の鍵が無く、逃げ道も閉じていれば null（呼び出し側で失敗にする）。 */
export function dbKey(env: JalertEnv): string | null {
  if (nonEmpty(env.JALERT_DB_KEY)) return env.JALERT_DB_KEY.trim()
  const name = nonEmpty(env.JALERT_SECRET_KEY_NAME) ? env.JALERT_SECRET_KEY_NAME.trim() : DEFAULT_SECRET_KEY_NAME
  const named = secretKeyByName(env.SUPABASE_SECRET_KEYS, name)
  if (named) return named
  if (legacyAllowed(env) && nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY)) return env.SUPABASE_SERVICE_ROLE_KEY.trim()
  return null
}
