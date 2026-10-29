/**
 * Content-Security-Policy の組み立て (2026-10-29・自主診断 ASVS 3.4.3)。
 *
 * - 全応答に付ける基本の指令 (BASE_CSP_DIRECTIVES) は next.config.ts が付ける。
 * - 画面 (HTML) には middleware が要求ごとの nonce を作り、script-src を足した CSP を付ける。
 *   Next は要求の見出しの CSP から nonce を読み、自分のスクリプトに付ける。共通の枠 (layout) の
 *   色の切り替えのスクリプトにも同じ nonce を渡す (x-nonce)。
 *   'strict-dynamic' なので、nonce の付いたスクリプトが読み込む分割のスクリプトは動き、
 *   差し込まれたスクリプト (XSS) は動かない。
 * - 書かないもの: frame-src (レコーダの Frigate の画面を iframe で読む)・style-src (React の
 *   インラインの style)・default-src (Supabase・Cloudflare・LiveKit などへの通信を塞がない)。
 *
 * Edge ランタイム (middleware) からも使うので Web 標準だけで書く。
 */

export const BASE_CSP_DIRECTIVES = [
  "frame-ancestors 'self'",  // クリックジャッキング（X-Frame-Options の後継）
  "base-uri 'none'",         // <base> は使わない。差し込まれても相対 URL の向き先を変えさせない
  "form-action 'self'",      // フォームの送信先を外部に向けられるのを防ぐ
  "object-src 'none'",       // 旧プラグイン経由の実行を落とす
]

/** 要求ごとの nonce (128 bit・base64)。 */
export function makeNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

/** 画面に付ける CSP。dev は React の開発用の eval を許す。 */
export function pageCsp(nonce: string, dev = process.env.NODE_ENV !== 'production'): string {
  return [
    ...BASE_CSP_DIRECTIVES,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Service Worker (/sw-v2.js) と hls.js の Worker (blob:)。'strict-dynamic' の下でも明示しておく
    "worker-src 'self' blob:",
  ].join('; ')
}
