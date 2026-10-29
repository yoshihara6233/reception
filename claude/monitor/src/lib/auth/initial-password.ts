/**
 * 管理者が決めたパスワード (初回のパスワード・管理者による再発行) の扱い (2026-10-30・自主診断 ASVS 6.4.1)。
 *
 * それまでは、管理者が利用者を作るときに入れたパスワードが、変更の強制も期限も無いまま
 * その人の長く使うパスワードになっていた。いまは:
 *   - 管理者が決めたパスワードは「仮」の印を付ける (Supabase Auth の app_metadata。本人は書き換えられない)
 *   - 仮のパスワードで入った人は、本人のパスワードに変えるまで画面と API を使えない (middleware)
 *   - 仮のパスワードは INITIAL_PASSWORD_TTL_HOURS で使えなくなる (ログインで断る。管理者が再発行する)
 *   - 本人が変えたら印を外す (/api/auth/initial-password)
 * 招待のメールにしなかった理由は docs (PR の本文) を参照: メールの届かない共用の端末の利用者
 * (手荷物検査の iPad など) がいる・今の作り方 (管理者が渡す) を変えずに済む。
 *
 * Edge ランタイム (middleware) からも使うので Web 標準だけで書く。
 */

/** 仮のパスワードの有効時間 (作ってから・再発行してから)。 */
export const INITIAL_PASSWORD_TTL_HOURS = 72

/** app_metadata のキー。値は仮のパスワードの期限 (ISO 8601)。 */
export const INITIAL_PASSWORD_KEY = 'initial_password_expires_at'

/** 仮のパスワードの状態。none = 本人のパスワード。 */
export type InitialPasswordState = 'none' | 'pending' | 'expired'

export function initialPasswordState(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
  now: Date = new Date(),
): InitialPasswordState {
  const v = user?.app_metadata?.[INITIAL_PASSWORD_KEY]
  if (v === undefined || v === null || v === '') return 'none'
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  // 壊れた値は期限切れとして扱う (通すほうへ倒さない)
  if (!Number.isFinite(t)) return 'expired'
  return t > now.getTime() ? 'pending' : 'expired'
}

/** 管理者がパスワードを決めたときに app_metadata へ入れる値。 */
export function initialPasswordMetadata(now: Date = new Date()): Record<string, string> {
  const exp = new Date(now.getTime() + INITIAL_PASSWORD_TTL_HOURS * 3600_000)
  return { [INITIAL_PASSWORD_KEY]: exp.toISOString() }
}

/** 本人が変えたあとに app_metadata へ入れる値 (null でキーが消える)。 */
export const CLEARED_INITIAL_PASSWORD: Record<string, null> = { [INITIAL_PASSWORD_KEY]: null }

// 見間違えやすい字 (0 O o 1 l I) を除いた英数字と記号
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+-=?@'

/**
 * 仮のパスワードを作る (管理者の画面の「自動で作る」)。暗号論的な乱数で、偏りが出ないよう
 * 棄却しながら字を選ぶ。既定の 16 文字で約 95 ビット。
 */
export function generateInitialPassword(
  length = 16,
  random: (buf: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const n = ALPHABET.length
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < length) {
    for (const x of random(new Uint8Array(length * 2))) {
      if (x >= limit) continue
      out += ALPHABET[x % n]
      if (out.length === length) break
    }
  }
  return out
}
