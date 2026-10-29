/**
 * ログインまわりの受け口を、同じサイトの画面からの要求に限る (ログインの CSRF を防ぐ・ASVS 3.5.1)。
 *
 * 別のサイトのフォームから text/plain で JSON に見える本文を送らせると、利用者を攻撃者の
 * アカウントでログインさせられる。ここでは本文が application/json であることと、ブラウザが付ける
 * Sec-Fetch-Site / Origin が同じサイトであることを確かめる。どちらの見出しも無い要求
 * (ブラウザ以外) は CSRF ではないので通す。
 */
export function isSameOriginJson(req: Request): boolean {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.toLowerCase().startsWith('application/json')) return false
  const site = req.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  const origin = req.headers.get('origin')
  if (!origin) return true
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
