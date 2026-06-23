/** ONVIF device/media service の base URL を組む純粋ヘルパ。onvif_port 既定 80。 */
export function buildOnvifEndpoint(host: string, onvifPort: number | null): string {
  return `http://${host}:${onvifPort ?? 80}`
}
