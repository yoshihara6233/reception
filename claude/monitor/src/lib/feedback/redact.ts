/**
 * 要望の本文の伏せ字（基本設計 §7・GVMS_CLOUD_SPEC §12.2）。
 *
 * 本文は管理者が書いた文なので、電話番号やメールアドレスが書かれることがある。
 * クラウドでは **伏せ字にしてから保存し、元の文は残さない**。送る前の確認画面でも
 * 「人の名前・連絡先・パスワードは書かないでください」と出すが、ここが最後の網。
 *
 * 伏せるもの:
 *   - URL（scheme:// と www. で始まるもの）
 *   - メールアドレス（全角の ＠ も）
 *   - IP アドレス（IPv4）— 受け入れ基準 §12.5-4「名前・IP・資格情報が含まれない」
 *   - 電話番号（日本の 10〜11 桁・+81・全角数字と全角ハイフンも）
 *
 * 人の名前は形で見分けられないので伏せない（確認画面の注意書きで防ぐ）。
 * 誤って伏せるより、伏せ漏れの方が害が大きいので、迷う形は伏せる側へ倒す。
 * ただし版（0.1.104）・日付（2026-10-06）・解像度（1920x1080）は伏せない。
 */

export const REDACTED = {
  url:   '[URL]',
  email: '[メールアドレス]',
  ip:    '[IP アドレス]',
  phone: '[電話番号]',
} as const

/** 数字（半角・全角） */
const D = '[0-9０-９]'
/** 電話番号の区切り（半角・全角のハイフン類・長音・括弧）。空白は別の形（PHONE_SPACED_RE）で扱う */
const HY = '[-‐‑–—―−－ー(（)）]'

const URL_RE = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"'「」『』（）()、。，．]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+[@＠][A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const IPV4_RE = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d]|\.\d)/g
/**
 * 電話番号の候補（区切りなし・ハイフンや括弧の区切り）。数字と区切りの連なりを取り、
 * 桁数で決める（下の isPhone）。前後が数字の中途は取らない。
 * 空白を区切りに含めないのは、「03-1234-5678 10 台」のように隣の数と
 * つながって桁数が合わなくなり、伏せ漏れになるのを避けるため。
 */
const PHONE_RE = new RegExp(
  `(?<!${D})(?:[+＋](?:81|８１)${HY}?)?[(（]?${D}(?:${D}|${HY}{1,2}(?=${D})){8,18}(?!${D})`,
  'g',
)
/** 空白で区切った電話番号（03 1234 5678 / +81 90 1234 5678）。かたまりの形で決め打つ */
const PHONE_SPACED_RE = new RegExp(
  `(?<!${D})(?:[+＋](?:81|８１)\\s)?${D}{1,5}\\s${D}{1,4}\\s${D}{3,4}(?!${D})`,
  'g',
)

function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

function isPhone(candidate: string): boolean {
  const s = toHalfWidthDigits(candidate)
  const digits = s.replace(/\D/g, '')
  if (/^[+＋]/.test(candidate)) {
    // +81 の後は 9〜10 桁（先頭の 0 を落とした国内番号）
    const rest = digits.replace(/^81/, '')
    return rest.length >= 9 && rest.length <= 10
  }
  // 国内表記: 0 から始まる 10〜11 桁
  return digits.startsWith('0') && digits.length >= 10 && digits.length <= 11
}

/** 本文の電話番号・メールアドレス・URL・IP アドレスを伏せ字にする。 */
export function redactFeedbackText(text: string): string {
  return text
    .replace(URL_RE, REDACTED.url)
    .replace(EMAIL_RE, REDACTED.email)
    .replace(IPV4_RE, REDACTED.ip)
    .replace(PHONE_RE, (m) => (isPhone(m) ? REDACTED.phone : m))
    .replace(PHONE_SPACED_RE, (m) => (isPhone(m) ? REDACTED.phone : m))
}
