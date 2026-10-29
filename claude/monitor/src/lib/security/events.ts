/**
 * 安全に関わる出来事の記録 (2026-10-29・自主診断 ASVS 16.3.1・16.3.2・16.3.3・16.2.4)。
 *
 * 以前は、認可の失敗 (401/403)・キオスクの PIN の失敗とロック・エッジのトークンの失敗・
 * 回数の制限の超過を、どこにも記録していなかった。権限の無い操作や総当たりを繰り返されても気づけない。
 * ここでは 1 件を 1 行の JSON にしてサーバのログ (Vercel) に書く (`[security] {...}`)。
 * 決まった形にしておくと、ログの検索・通知の条件に使える。
 *
 * **秘密を書かない**: パスワード・PIN・トークン・メールアドレスは載せない。利用者は ID (UUID) で、
 * 回数の制限の鍵は種類 (コロンの前) だけを書く。
 *
 * Edge ランタイム (middleware) からも使うので Web 標準だけで書く。
 */

export type SecurityEventKind =
  | 'authz.denied'          // 役割・範囲の外 (guard の 401/403)
  | 'auth.mfa_required'     // 多要素の番号が済んでいない (middleware)
  | 'auth.foreign_token'    // 拠点向けのトークンでクラウドに来た (middleware)
  | 'auth.tenant_suspended' // 停止したテナントの利用者 (middleware)
  | 'auth.boundary'         // 手荷物検査店長が許可パスの外へ (middleware)
  | 'auth.login_failed'     // ログインのパスワードの誤り (/api/auth/login)
  | 'auth.mfa_failed'       // 多要素の番号の誤り (/api/auth/mfa・/api/account/mfa/verify)
  | 'auth.recovery_failed'  // 再設定の番号の誤り・期限切れ (/api/auth/recovery/verify)
  | 'auth.cross_site'       // 別のサイトからのログインまわりの要求
  | 'edge.auth_failed'      // エッジのトークンが合わない・停止したテナント
  | 'kiosk.pin_failed'      // キオスクの PIN の誤り
  | 'kiosk.pin_locked'      // キオスクの PIN のロック
  | 'kiosk.pin_ok'          // キオスクの PIN のサインイン
  | 'rate_limited'          // 回数の制限を超えた

export interface SecurityEvent {
  kind: SecurityEventKind
  /** 利用者の ID (UUID)。分からなければ省く */
  actor?: string | null
  ip?: string | null
  path?: string | null
  status?: number
  /** 店舗・役割・理由など、秘密でない補足 */
  detail?: Record<string, string | number | boolean | null | undefined>
}

/** 1 件を 1 行の JSON にしてログに書く。失敗しても呼び出し側を止めない。 */
export function logSecurityEvent(e: SecurityEvent): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...e })
    console.warn(`[security] ${line}`)
  } catch {
    /* 記録の失敗で本処理を止めない */
  }
}

/** 要求の接続元 (Vercel は x-forwarded-for の先頭に実クライアントを置く)。 */
export function requestIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() || null : null
}
