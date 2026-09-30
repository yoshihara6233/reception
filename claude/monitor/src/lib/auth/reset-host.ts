/**
 * パスワード再設定のリンクを、どのホストへ向けてよいか。
 *
 * リンクには回復用のトークンが載るので、**要求の Host ヘッダをそのまま信じると、
 * 偽の Host で送られた要求からトークンを他所のドメインへ流せてしまう**（開いたリダイレクト・
 * トークンの持ち出し）。自分のドメインだけを許し、それ以外は既定の本番 URL に倒す。
 *
 * 許すもの: 本番の専用ドメイン gvms-cloud.com (apex とサブドメイン・2026-09-30〜)、
 * 会社ドメイン *.genesis-edge.com、Vercel のプレビュー *.vercel.app、ローカル開発。
 */
export const RESET_FALLBACK_ORIGIN = 'https://gvms-cloud.com'

export function isAllowedResetHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (h === '') return false
  return (
    h === 'gvms-cloud.com' || h.endsWith('.gvms-cloud.com') ||
    h.endsWith('.genesis-edge.com') ||
    h.endsWith('.vercel.app') ||
    h === 'localhost' || h === '127.0.0.1'
  )
}

/** 要求のヘッダから、再設定のリンクの起点 (オリジン) を決める。許されないホストは既定へ。 */
export function resetLinkOrigin(host: string, proto: string | null): string {
  const hostname = host.split(':')[0]
  if (!isAllowedResetHost(hostname)) return RESET_FALLBACK_ORIGIN
  const p = proto === 'http' ? 'http' : 'https'
  return `${p}://${host}`
}
