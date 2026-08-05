/**
 * アクセストークン単位の判定キャッシュ（ミドルウェア／ルート共用）。
 *
 * ## なぜ要るか
 *
 * ライブ画像（grid ≒2秒・snapshot ≒1秒ポーリング）は1フレームごとに
 *   - ミドルウェア: `getUser()`（Auth へ往復）＋ `admin_users` 1行引き
 *   - ルート:       `getUser()`（Auth へ往復）＋ 可視性の1行引き
 * を実行していた。実測で Supabase の API Gateway 約23万 req/24h の主因。
 * 1視聴者が1時間見るだけで Auth に約7,000回問い合わせる計算になる。
 *
 * そこで「そのトークンで一度実検証して得た判定」を短時間だけ持ち回る。
 * **判定を作るときは必ず実検証する**（キャッシュはあくまで再実行の省略であって、
 * 検証の代替ではない）。
 *
 * ## なぜ JWKS ローカル検証にしないか
 *
 * 公開鍵でローカル検証すれば Auth への往復はゼロにできるが、トークンの `exp`
 * （既定で約1時間）までログアウト・利用者削除・パスワード変更が一切効かなくなる。
 * 監視映像の可視性でその窓は長すぎる。TTL を自分で決められるキャッシュなら、
 * 失効の遅れを 30 秒に抑えたまま往復を 1/30 に減らせる。
 *
 * ## 実行環境
 *
 * ミドルウェア（Edge ランタイム）とルートハンドラ（Node）の両方から使うため、
 * `node:crypto` や `Buffer` は使わず Web 標準（`crypto.subtle` / `atob`）で書く。
 * Map はインスタンス（isolate）内に閉じる＝スケールアウトすると命中率は下がるが、
 * 正しさには影響しない（未命中は実検証に落ちるだけ）。
 */

/** 判定を持ち回す時間。延ばすほど失効・権限変更の反映が遅れる。 */
export const TOKEN_CACHE_TTL_MS = 30_000
/** ウォームインスタンスで無制限に伸びないための上限（超えたら丸ごと捨てる）。 */
const MAX_ENTRIES = 5_000

/**
 * アクセストークンは生のままメモリに置かない（ヒープダンプやログに出た時の被害を避ける）。
 * 要件は衝突しないことだけなので SHA-256 で十分。
 */
export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * JWT の `exp` を**署名検証せずに**読む（ms）。読めなければ null。
 *
 * 検証していない値を信じてよいのは、これを **キャッシュを短くする方向にしか使わない**ため。
 * 攻撃者が exp を伸ばした細工トークンを渡しても、初回は必ず実検証されるのでキャッシュに
 * 載らない。逆に exp が近ければ早く切るだけ＝安全側にしか動かない。
 */
export function jwtExpiresAtMs(token: string): number | null {
  try {
    const seg = token.split('.')[1]
    if (!seg) return null
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    // 非ASCII を含むペイロードの取りこぼし等。TTL だけで切ればよいので null に倒す。
    return null
  }
}

export interface TokenCache<T> {
  /** 命中なら `{ value }`、未命中／期限切れなら undefined。 */
  read(tokenHash: string, scope: string, now?: number): { value: T } | undefined
  write(tokenHash: string, scope: string, value: T, expMs: number | null, now?: number): void
  reset(): void
  size(): number
}

/**
 * @param ttlMs 既定は TOKEN_CACHE_TTL_MS。用途ごとに短くはできるが、長くしないこと。
 */
export function createTokenCache<T>(ttlMs: number = TOKEN_CACHE_TTL_MS): TokenCache<T> {
  const map = new Map<string, { value: T; at: number; expMs: number | null }>()
  // scope は同じトークンに複数の判定（エッジごとの可視性・ロール等）を持たせるための区別。
  const keyOf = (tokenHash: string, scope: string) => `${tokenHash}\n${scope}`

  return {
    read(tokenHash, scope, now = Date.now()) {
      const key = keyOf(tokenHash, scope)
      const hit = map.get(key)
      if (!hit) return undefined
      // TTL とトークン自身の失効の、早い方で切る。
      const until = hit.expMs === null ? hit.at + ttlMs : Math.min(hit.at + ttlMs, hit.expMs)
      if (now >= until) {
        map.delete(key)
        return undefined
      }
      return { value: hit.value }
    },
    write(tokenHash, scope, value, expMs, now = Date.now()) {
      if (map.size >= MAX_ENTRIES) map.clear()
      map.set(keyOf(tokenHash, scope), { value, at: now, expMs })
    },
    reset() { map.clear() },
    size() { return map.size },
  }
}
