/**
 * 「このアプリの絶対URL」の単一源。
 *
 * 【経緯】同じ用途の env が2つ（`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL`）あり、
 * 既定値も箇所ごとにバラバラだった。とくに BCP 完了メールだけ既定値が空文字で、
 * env 未設定時に `href="/bcp/<id>"` という **メールでは絶対に開けない相対リンク**を
 * 出していた（2026-08-03 発見。発令メールは既定値を持っていたので動いており、
 * 完了メールだけが死んでいた＝差分に気づきにくい壊れ方）。
 *
 * メールのリンク切れは送った側からは見えない。だから既定値を1箇所に集約し、
 * env 未設定でも必ず絶対URLになるようにする。
 */

/** env 未設定時の既定（本番URL）。ローカル開発では env で上書きする。 */
const FALLBACK_ORIGIN = 'https://intereco-monitor.vercel.app'

/**
 * 末尾スラッシュを落とした絶対オリジンを返す。
 * `NEXT_PUBLIC_SITE_URL`（env-check に載っている正）を優先し、
 * 旧名 `NEXT_PUBLIC_APP_URL` も後方互換で読む。
 */
export function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    FALLBACK_ORIGIN
  return raw.replace(/\/+$/, '')
}

/**
 * 絶対URLを組み立てる。**メール・Webhook に載せるリンクは必ずこれを通す**
 * （相対パスはメーラーが解決できず、押しても何も起きないリンクになる）。
 */
export function absoluteUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
