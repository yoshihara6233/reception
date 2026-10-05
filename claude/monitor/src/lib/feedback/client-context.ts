/**
 * クラウドの画面から送る要望に「自動で添える項目」（基本設計 §3.2）。
 *
 * 添えるのは 画面のパス・ブラウザの種類と版・OS の種類・画面の幅 だけ。
 * 送る前の確認で、ここで作った値を**そのまま**見せる（見せたものと送るものをずらさない）。
 *
 * 添えないもの: 検索条件（?以降）・利用者の名前・カメラの名前・IP。
 * 画面のパスの中の ID（拠点・カメラの UUID）は [id] に置き換える。どの画面かが分かれば足り、
 * ID は運営には意味が無く、テナントの持ち物を指す値を外へ出す理由が無いため。
 */
import type { FeedbackContext } from './schema'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** 画面のパス（検索条件を落とし、UUID を [id] にする）。 */
export function screenPath(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] || '/').replace(UUID_RE, '[id]')
  return p.slice(0, 128)
}

/** ブラウザの種類と主版（例 chrome/141・edge/141・safari/18・firefox/131）。分からなければ other。 */
export function browserLabel(ua: string): string {
  const m = (re: RegExp) => ua.match(re)?.[1]
  const edge = m(/Edg(?:e|A|iOS)?\/(\d+)/)
  if (edge) return `edge/${edge}`
  const firefox = m(/(?:Firefox|FxiOS)\/(\d+)/)
  if (firefox) return `firefox/${firefox}`
  const chrome = m(/(?:Chrome|CriOS)\/(\d+)/)
  if (chrome) return `chrome/${chrome}`
  const safari = /Safari\//.test(ua) ? m(/Version\/(\d+)/) : undefined
  if (safari) return `safari/${safari}`
  return 'other'
}

/** OS の種類（windows / macos / ios / android / linux / other）。版は添えない。 */
export function osLabel(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Windows/.test(ua)) return 'windows'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos'
  if (/Linux|CrOS/.test(ua)) return 'linux'
  return 'other'
}

/** 画面の幅（例 1920x1080）。 */
export function viewportLabel(w: number, h: number): string {
  return `${Math.round(w)}x${Math.round(h)}`
}

export function buildClientContext(p: { pathname: string; userAgent: string; width: number; height: number }): FeedbackContext {
  return {
    screen: screenPath(p.pathname),
    browser: browserLabel(p.userAgent),
    os: osLabel(p.userAgent),
    viewport: viewportLabel(p.width, p.height),
  }
}

/** 確認画面で見せる名前 */
export const CONTEXT_LABEL: Record<keyof Omit<FeedbackContext, 'camera'>, string> = {
  screen: '画面のパス',
  agent_version: '版',
  browser: 'ブラウザ',
  os: 'OS',
  viewport: '画面の幅',
  error_code: 'エラーの種類',
}
