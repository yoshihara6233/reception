/**
 * Cookie の名前の接頭辞 (2026-10-29・自主診断 ASVS 3.3.1・3.3.3)。
 *
 * `__Host-` を付けた Cookie は、ブラウザが「Secure・Path=/・Domain なし」のときだけ受け取る。
 * 同じ親ドメインのほかのホストや平文の http から、同じ名前の Cookie を置かれて上書きされない。
 * Path を絞る Cookie (ライブの中継) は `__Host-` を使えないので `__Secure-` (Secure 必須) にする。
 *
 * 本番のビルド (NODE_ENV=production・Vercel の本番とプレビュー) でだけ付ける。手元の
 * http://localhost の開発と E2E では付けない (Secure の Cookie を置けない場合があるため)。
 * セッションの Cookie の Secure も同じ条件にそろえる (lib/supabase/cookie-options.ts)。
 *
 * 読むときは、接頭辞つきの名前が無ければ以前の名前も見る (切り替えた直後のキオスクなどを止めない)。
 * middleware (Edge) からも使うので Web 標準だけで書く。
 */
export const PREFIXED_COOKIES = process.env.NODE_ENV === 'production'

/** Path=/ の Cookie の名前 (本番では `__Host-`)。 */
export function hostCookieName(base: string): string {
  return PREFIXED_COOKIES ? `__Host-${base}` : base
}

/** Path を絞る Cookie の名前 (本番では `__Secure-`)。 */
export function secureCookieName(base: string): string {
  return PREFIXED_COOKIES ? `__Secure-${base}` : base
}

interface CookieJar { get(name: string): { value: string } | undefined }

/** Path=/ の Cookie を読む。接頭辞つきが無ければ以前の名前を読む。 */
export function readHostCookie(jar: CookieJar, base: string): string | undefined {
  return jar.get(hostCookieName(base))?.value ?? jar.get(base)?.value
}

/**
 * 画面 (ブラウザ) から好みの Cookie (言語・メニューの開閉・店舗) を書く。https では `__Host-` と
 * Secure を付ける。サーバは readHostCookie で両方の名前を読む。
 */
export function writeClientPrefCookie(base: string, value: string, maxAgeSec: number): void {
  const https = typeof location !== 'undefined' && location.protocol === 'https:'
  const name = https ? `__Host-${base}` : base
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSec}; samesite=lax${https ? '; secure' : ''}`
  if (https) document.cookie = `${base}=; path=/; max-age=0; samesite=lax`   // 以前の名前は消す
}
