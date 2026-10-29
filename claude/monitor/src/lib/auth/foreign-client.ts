/**
 * 拠点 (G・VMS) 向けに出したトークンを、クラウドの画面と API で使わせない (2026-10-29・自主診断 ASVS 9.2.3・10.3.1)。
 *
 * ログインの一本化 (GVMS_CLOUD_SPEC §9) で、クラウドは拠点ごとの OAuth クライアントへ利用者の
 * トークンを出す。Supabase Auth はそのトークンに `client_id` を載せる。クラウド自身のログイン
 * (メールとパスワード・多要素) のトークンには載らない。拠点に渡ったトークンを Cookie に入れて
 * クラウドへ持ち込めば、その利用者になりすませるので、`client_id` の付いたトークンは断る。
 * DB でも同じ条件で断っている (supabase/migrations/20261029090000_oauth_client_token_scope.sql)。
 *
 * Edge ランタイム (middleware) からも使うので Web 標準だけで書く。
 */

/**
 * JWT の `client_id` を**署名検証せずに**読む。無ければ null。
 *
 * 信じてよいのは、同じトークンを `getUser()` (Auth が署名と失効を確かめる) に通したあとだけ
 * (lib/auth/mfa.ts の jwtAal と同じ)。
 */
export function jwtClientId(token: string): string | null {
  try {
    const seg = token.split('.')[1]
    if (!seg) return null
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const cid = (JSON.parse(json) as { client_id?: unknown }).client_id
    return typeof cid === 'string' && cid !== '' ? cid : null
  } catch {
    return null
  }
}

/** このトークンは OAuth のクライアント (拠点) 向けか。 */
export function isForeignClientToken(token: string | null): boolean {
  return !!token && jwtClientId(token) !== null
}
