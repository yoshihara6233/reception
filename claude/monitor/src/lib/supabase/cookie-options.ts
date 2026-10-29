/**
 * ログインのセッションの Cookie の属性 (2026-10-29・自主診断 ASVS 3.3.4・3.3.1)。
 *
 * 以前はブラウザの Supabase クライアントがログイン・多要素・再設定を行い、セッション (アクセス
 * トークンと更新トークン) を JavaScript から読める Cookie に置いていた。画面に XSS が 1 つあれば、
 * トークンを持ち出してほかの端末から入れる。いまはログインまわりをすべてサーバの受け口
 * (/api/auth/*・/api/account/mfa) で行い、Cookie を HttpOnly にする。ブラウザの Supabase
 * クライアントは使わない (src/test/no-browser-supabase.test.ts が見張る)。
 *
 * Secure は Vercel (本番・プレビュー) でだけ付ける。手元の http://localhost の試験で Cookie が
 * 落ちないように。
 */
import type { CookieOptionsWithName } from '@supabase/ssr'

export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  httpOnly: true,
  secure: process.env.VERCEL === '1',
  sameSite: 'lax',
  path: '/',
}
