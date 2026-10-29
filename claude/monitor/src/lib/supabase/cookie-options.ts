/**
 * ログインのセッションの Cookie の属性 (2026-10-29・自主診断 ASVS 3.3.4・3.3.1)。
 *
 * 以前はブラウザの Supabase クライアントがログイン・多要素・再設定を行い、セッション (アクセス
 * トークンと更新トークン) を JavaScript から読める Cookie に置いていた。画面に XSS が 1 つあれば、
 * トークンを持ち出してほかの端末から入れる。いまはログインまわりをすべてサーバの受け口
 * (/api/auth/*・/api/account/mfa) で行い、Cookie を HttpOnly にする。ブラウザの Supabase
 * クライアントは使わない (src/test/no-browser-supabase.test.ts が見張る)。
 *
 * Secure と名前の `__Host-` は本番のビルドでだけ付ける (lib/security/cookie-names.ts)。手元の
 * http://localhost の試験で Cookie が落ちないように。名前を変えた日 (2026-10-29) は、以前の名前
 * (sb-<ref>-auth-token) のセッションが読めなくなるので、利用者は 1 回ログインし直す
 * (以前の Cookie は middleware が消す)。
 */
import type { CookieOptionsWithName } from '@supabase/ssr'
import { PREFIXED_COOKIES } from '@/lib/security/cookie-names'

/** 本番のセッションの Cookie の名前 (分割されると .0・.1 が付く)。 */
export const SESSION_COOKIE_NAME = '__Host-gvms-auth'

export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  ...(PREFIXED_COOKIES ? { name: SESSION_COOKIE_NAME } : {}),
  httpOnly: true,
  secure: PREFIXED_COOKIES,
  sameSite: 'lax',
  path: '/',
}
