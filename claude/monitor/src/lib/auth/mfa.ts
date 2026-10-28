/**
 * 多要素認証（認証アプリの 6 桁の番号・Supabase Auth の TOTP・2026-10-28）。
 *
 * G・VMS（拠点）と同じ考え方にそろえる（NVMS の docs/SECURITY_REVIEW.md §1.6）:
 *   - 使うかどうかは利用者ごとに選ぶ（/account/security で登録）。
 *   - 登録した人は、パスワードのあとに番号を確かめるまで（aal1 → aal2）、画面と API を使えない。
 *     中央で止めるのは middleware（ログイン・パスワード再設定・キオスクなどの許可パスは対象外）。
 *   - 端末を無くしたら、管理者が本人を確かめてから外す（/api/admin/users/[id]/mfa-reset）。
 *   - メールで番号を送る方式は作らない（届かないと締め出し・NIST SP 800-63B が 2 つ目の要素と認めない）。
 *
 * Edge ランタイム（middleware）からも使うので Web 標準だけで書く。
 */

/**
 * JWT の `aal` を**署名検証せずに**読む。読めなければ null。
 *
 * 信じてよいのは、同じトークンを `getUser()`（Auth が署名と失効を確かめる）に通したあとだけ。
 * 呼び出し側（middleware）は、判定を作るときに必ず getUser を通す。
 */
export function jwtAal(token: string): string | null {
  try {
    const seg = token.split('.')[1]
    if (!seg) return null
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const aal = (JSON.parse(json) as { aal?: unknown }).aal
    return typeof aal === 'string' ? aal : null
  } catch {
    return null
  }
}

/** 確認済みの多要素（TOTP）を持っているか。 */
export function hasVerifiedFactor(user: { factors?: Array<{ status?: string }> | null } | null): boolean {
  return !!user?.factors?.some((f) => f.status === 'verified')
}

/**
 * 番号の確認が済んでいないか（多要素を登録しているのに、このトークンは aal2 でない）。
 * true なら、画面は /login/mfa へ、API は 401 で止める。
 */
export function mfaPending(
  user: { factors?: Array<{ status?: string }> | null } | null,
  token: string | null,
): boolean {
  if (!user || !token) return false
  return hasVerifiedFactor(user) && jwtAal(token) !== 'aal2'
}
