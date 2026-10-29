/**
 * 店の発報の Webhook の宛先の検査 (2026-10-29・自主診断 ASVS 12.3.1・13.2.4・15.3.2・16.5.2)。
 *
 * 宛先は店の管理者が画面で決める。以前は形を見ずに保存し、そのまま fetch していた。
 *   - http を受けると、発報の中身 (店の名前・種別・時刻) が平文で流れる
 *   - 内部の住所 (ループバック・私設・リンクローカル) を受けると、クラウドのサーバから
 *     その住所へ要求を出させられる
 * 保存のときと送るときの両方で、この関数で確かめる。名前で書かれた内部のホストまでは
 * ここでは見分けられない (名前を引くのは送るときの基盤) ので、IP の直書きと代表的な名前を断る。
 */

const INTERNAL_NAMES = /^(localhost|metadata(\.google\.internal)?|.*\.(local|internal|localdomain|lan))$/i

function internalIPv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/** 宛先がだめなら理由 (画面に出す文) を、よければ null を返す。空は「使わない」なので null。 */
export function webhookUrlProblem(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.length > 2000) return 'Webhook の URL が長すぎます (2,000 文字まで)'
  let u: URL
  try { u = new URL(v) } catch { return 'Webhook の URL の形が正しくありません' }
  if (u.protocol !== 'https:') return 'Webhook の URL は https:// で始まるものにしてください'
  if (u.username || u.password) return 'Webhook の URL に利用者名やパスワードを入れないでください'
  const h = u.hostname.toLowerCase()
  if (h.startsWith('[') || internalIPv4(h) || INTERNAL_NAMES.test(h) || !h.includes('.')) {
    return 'Webhook の宛先に内部の住所は使えません'
  }
  return null
}

/** 発報の Webhook を送る。転送を追わず (宛先を変えさせない)、5 秒で打ち切る。 */
export async function postAlarmWebhook(url: string, body: unknown): Promise<boolean> {
  if (webhookUrlProblem(url)) {
    console.error('[alarm webhook] 宛先が検査に通らないため送りません')
    return false
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}
