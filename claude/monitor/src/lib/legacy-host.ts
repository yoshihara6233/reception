/**
 * 旧 URL（intereco-monitor.vercel.app）で開かれた画面を、新 URL（gvms-cloud.com）へ移す。
 *
 * 2026-09-30 に専用ドメインへ移した（手順は docs/domain-gvms-cloud.md の 13）。旧 URL は
 * Vercel の既定の URL として消えないので、ブックマークや古いメールのリンクから来た人を
 * 新 URL へ送る。ログインの状態はドメインごとなので、移った先で一度ログインし直しになる。
 *
 * **転送しないもの**（旧 URL のまま動かし続ける）:
 * - `/api/` — 接続先を移し忘れた拠点のアップリンク（POST）や、Edge Function・cron の呼び出し。
 *   POST をリダイレクトすると本文を落とすクライアントがあり、拠点が黙って止まる。
 * - `/kiosk` — iPad にホーム画面のアプリとして置いた手荷物検査の端末。別オリジンへ移すと
 *   アプリの外（Safari）で開いてしまい、無人の端末が止まる。新 URL で置き直すまで旧 URL で動かす。
 * - Service Worker の本体（`/sw.js`・`/sw-v2.js`）— 旧 URL に登録済みの SW の更新の取得が
 *   リダイレクトで失敗しないように。
 *
 * 一時的な転送（307）にする。恒久（308）はブラウザが無期限に覚えるので、戻したいときに戻せない。
 */

export const LEGACY_HOSTS = ['intereco-monitor.vercel.app']

const KEEP_PREFIXES = ['/api', '/kiosk', '/sw.js', '/sw-v2.js']

function kept(path: string): boolean {
  return KEEP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * 転送先の絶対 URL を返す。転送しないときは null。
 * `host` は要求の Host（ポート付きでもよい）、`base` は新 URL のオリジン（appBaseUrl()）。
 */
export function legacyRedirectTarget(host: string, pathname: string, search: string, base: string): string | null {
  const hostname = host.split(':')[0].trim().toLowerCase().replace(/\.$/, '')
  if (!LEGACY_HOSTS.includes(hostname)) return null
  if (kept(pathname)) return null
  // new URL(pathname, base) にすると `//evil.example/x` が別のオリジンとして解決される
  // （開いたリダイレクト）。オリジンは base に固定し、道と問い合わせだけを差し替える。
  let to: URL
  try {
    to = new URL(base)
  } catch {
    return null
  }
  to.pathname = pathname
  to.search = search
  // 新 URL の設定が旧 URL を指していたら、転送すると輪になる。
  if (LEGACY_HOSTS.includes(to.hostname.toLowerCase())) return null
  return to.toString()
}
