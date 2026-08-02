/**
 * NVR 時計と実時刻（エッジ＝NTP 同期済み）の差の実測。
 *
 * HTTP 応答の Date ヘッダ（RFC 7231・1秒粒度）を読むだけなので認証不要
 * （i-PRO NVR は未認証でも 401 応答に Date が付く）。往復の中点を基準に
 * 差を秒で返す。正＝NVR が進んでいる。測定不能時は null。
 *
 * BCP・発報前コマ・検査クリップは NVR のタイムラインから切り出すため、
 * NVR の時計ズレはそのまま証跡の時刻ズレになる（実例: NTP 未設定で +3 分）。
 * この実測値を edge_devices / inspection_clips に報告し、ズレの検知を仕組み化する。
 */
import { logger } from '../logger.js'

export async function measureNvrClockOffsetSec(
  host: string,
  timeoutMs = 5_000,
): Promise<number | null> {
  const url = host.startsWith('http') ? host : `https://${host}`
  try {
    const t0 = Date.now()
    // 自己署名 HTTPS 許容（Bun: tls.rejectUnauthorized=false）。HEAD はボディなしで最軽量。
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
      tls: { rejectUnauthorized: false },
    } as unknown as RequestInit)
    const t1 = Date.now()
    const dateHdr = res.headers.get('date')
    if (!dateHdr) return null
    const serverMs = Date.parse(dateHdr)
    if (!Number.isFinite(serverMs)) return null
    return Math.round((serverMs - (t0 + t1) / 2) / 1_000)
  } catch (e) {
    logger.debug({ err: (e as Error).message, url }, 'nvr-clock: measure failed')
    return null
  }
}
