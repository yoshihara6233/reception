/**
 * 別のサイトからの書き込みの要求 (CSRF) を、すべての受け口でまとめて断る
 * (2026-10-29・自主診断 ASVS 3.5.1・3.5.2)。
 *
 * セッションの Cookie は SameSite=Lax なので、別のサイトのフォームの POST には付かない。ただ、
 * 受け口は Content-Type を確かめないので、text/plain の本文がプリフライト無しで届く余地が残っていた。
 * ここではブラウザが付ける Sec-Fetch-Site (無ければ Origin) を見て、別のサイトからの書き込み
 * (POST・PUT・PATCH・DELETE) を middleware で 403 にする。
 *
 * どちらの見出しも無い要求 (エッジ・nvmsd・カメラの通知・cron など、ブラウザ以外) は CSRF では
 * ないので通す。読み取り (GET) は対象にしない。
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isCrossSiteWrite(req: Request): boolean {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return false
  const site = req.headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') return origin === 'null'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}
