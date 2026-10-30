/**
 * サインイン中の端末 (アカウント › サインイン中の端末・2026-10-31・自主診断 ASVS 7.5.2) の道具。
 * DB の関数は supabase/migrations/20261031090000_my_sessions.sql (本人の分だけを読む・切る)。
 */

export interface MySession {
  id: string
  created_at: string
  last_seen: string
  user_agent: string | null
  ip: string | null
  aal: string | null
  current: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 画面から来たセッションの ID が UUID の形か */
export function validSessionId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/**
 * ブラウザの名乗り (User-Agent) から、端末の見分けに使う短い名前を作る (例「Chrome・Windows」)。
 * 名乗りは端末が自由に書けるので、表示の手がかりにとどめ、判断には使わない。
 */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return '不明な端末'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'ブラウザ'
  const os =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return os ? `${browser}・${os}` : browser
}
