/**
 * パスワードの再設定の画面を、再設定のセッションでだけ使わせる (2026-10-29・自主診断 ASVS 6.2.3)。
 *
 * 以前は、メールのリンクの番号が無くても「今あるセッション」があれば再設定の画面が開き、
 * 今のパスワードを聞かずに書き換えられた。盗まれたセッションでパスワードを変えて乗っ取れる。
 * いまは、トークンの amr (どの方法で入ったか) に、再設定の番号 (recovery・otp) で入った記録が
 * 最近 (15 分以内) あるときだけ通す。メールのリンクから来た人は、画面がその場で番号を確かめるので
 * この条件を満たす。
 *
 * ブラウザ (再設定の画面) からも使うので Web 標準だけで書く。
 */

/** 再設定の番号で入ってから、再設定の画面を使える時間 (秒)。 */
export const RECOVERY_WINDOW_SEC = 15 * 60

interface AmrEntry { method?: unknown; timestamp?: unknown }

function claims(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split('.')[1]
    if (!seg) return null
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * このアクセストークンは、最近の再設定の番号で入ったセッションか。
 * nowSec は試験のため (既定は今)。
 */
export function isRecentRecoverySession(token: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!token) return false
  const c = claims(token)
  const amr = c?.amr
  if (!Array.isArray(amr)) return false
  return amr.some((e: AmrEntry) => {
    const m = typeof e?.method === 'string' ? e.method : ''
    const ts = typeof e?.timestamp === 'number' ? e.timestamp : 0
    return (m === 'recovery' || m === 'otp') && ts > 0 && nowSec - ts <= RECOVERY_WINDOW_SEC
  })
}
