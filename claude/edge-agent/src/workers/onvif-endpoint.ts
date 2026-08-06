/**
 * ONVIF device/media service の base URL を組む純粋ヘルパ。
 *
 * 以前は常に `http://` を付けていたため、**HTTPS でしか喋らない機器**（i-PRO NVR は
 * ONVIF ポート既定 443）に対して平文で叩きに行き、`探索失敗: The socket connection was
 * closed unexpectedly` になっていた。ポート番号からスキームを決める。
 */

/** このポートなら TLS とみなす。443/8443 は監視機器の事実上の慣行。 */
const HTTPS_PORTS = new Set([443, 8443])

export function buildOnvifEndpoint(host: string, onvifPort: number | null): string {
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, '')   // URL 直指定はそのまま
  const port = onvifPort ?? 80
  return `${HTTPS_PORTS.has(port) ? 'https' : 'http'}://${host}:${port}`
}
