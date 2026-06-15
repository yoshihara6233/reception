/**
 * F46.16: i-PRO FirmwareDetector
 *
 * NVR の FW Ver を検出する。優先順位:
 *   1. CGI: /cgi-bin/getsysteminfo
 *   2. ONVIF: GetDeviceInformation
 *   3. HTTP Server ヘッダー (fallback)
 *
 * 全失敗時は fwMajor=0, modelFamily='unknown' を返し、
 * 上位は CONSERVATIVE_CAPABILITIES にフォールバックする。
 *
 * 設計: docs/tier3/firmware-capability-matrix.md
 */
import type { FirmwareInfo, NvrAdapterConfig } from '../../_base'
import { IProCgiClient } from './cgi-client'
import type { NvrCredentials } from '../../_base'

export interface DetectFirmwareOptions {
  endpoint:     string
  credentials:  NvrCredentials
  timeoutMs?:   number
}

/**
 * i-PRO 機器の FW を検出。
 * @returns FirmwareInfo (検出失敗時は fwMajor=0)
 */
export async function detectIProFirmware(
  opts: DetectFirmwareOptions,
): Promise<FirmwareInfo> {
  const now = new Date()

  // ── 1. CGI: /cgi-bin/getsysteminfo ──────────────────────────────────────
  try {
    const client = new IProCgiClient({
      endpoint:    opts.endpoint,
      credentials: opts.credentials,
      timeoutMs:   opts.timeoutMs ?? 5000,
      retryCount:  1,
    })
    const res = await client.get({ path: '/cgi-bin/getsysteminfo' })
    if (res.type === 'text') {
      const parsed = parseCgiSysInfo(res.body)
      if (parsed) {
        return { ...parsed, detectedAt: now, source: 'cgi' }
      }
    }
  } catch {
    // CGI 失敗 → ONVIF へ
  }

  // ── 2. ONVIF GetDeviceInformation ───────────────────────────────────────
  try {
    const fw = await detectViaOnvif(opts)
    if (fw) {
      return { ...fw, detectedAt: now, source: 'onvif' }
    }
  } catch {
    // ONVIF 失敗 → Header fallback へ
  }

  // ── 3. HTTP Server ヘッダー fallback ────────────────────────────────────
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 3000)
    try {
      const res = await fetch(opts.endpoint, { method: 'HEAD', signal: ctl.signal })
      const server = res.headers.get('server') ?? ''
      if (server) {
        return {
          vendor:       'i-pro',
          modelFamily:  inferFamilyFromServer(server),
          modelNumber:  'unknown',
          fwVersion:    server,
          fwMajor:      0,
          fwMinor:      0,
          fwPatch:      0,
          detectedAt:   now,
          source:       'header',
        }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // 全て失敗
  }

  // ── 全失敗時の fallback ─────────────────────────────────────────────────
  return {
    vendor:       'i-pro',
    modelFamily:  'unknown',
    modelNumber:  'unknown',
    fwVersion:    '0.0-0000',
    fwMajor:      0,
    fwMinor:      0,
    fwPatch:      0,
    detectedAt:   now,
    source:       'header',
  }
}

// ─── CGI レスポンスパース ────────────────────────────────────────────────────

/**
 * /cgi-bin/getsysteminfo の典型的なレスポンス形式:
 *   ModelName=WJ-NX300K
 *   FirmwareVersion=3.42-0001
 *   SerialNumber=AB12345678
 *   HardwareVersion=2.10
 *   MacAddress=00:80:F0:XX:XX:XX
 *
 * (改行 or & 区切り、機種により微差あり)
 */
export function parseCgiSysInfo(body: string): Omit<FirmwareInfo, 'detectedAt' | 'source'> | null {
  // key=value のペアを抽出 (改行 or & or ; 区切り)
  const pairs: Record<string, string> = {}
  for (const line of body.split(/[\r\n&;]+/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (m) pairs[m[1]] = m[2]
  }

  const modelNumber = pairs.ModelName ?? pairs.modelname ?? pairs.Model
  const fwVersion   = pairs.FirmwareVersion ?? pairs.firmwareversion ?? pairs.FwVersion

  if (!modelNumber || !fwVersion) {
    return null
  }

  const { major, minor, patch } = parseSemver(fwVersion)
  return {
    vendor:       'i-pro',
    modelFamily:  inferFamily(modelNumber),
    modelNumber,
    fwVersion,
    fwMajor:      major,
    fwMinor:      minor,
    fwPatch:      patch,
    hwVersion:    pairs.HardwareVersion ?? pairs.HwVersion,
    serial:       pairs.SerialNumber ?? pairs.Serial,
  }
}

/**
 * FW バージョン文字列をパース。
 *
 * 想定形式:
 *   '3.42-0001'  → major=3 minor=42 patch=1
 *   '1.20'       → major=1 minor=20 patch=0
 *   'V2.10'      → major=2 minor=10 patch=0
 */
export function parseSemver(s: string): { major: number; minor: number; patch: number } {
  const cleaned = s.replace(/^[Vv]/, '')
  const m = cleaned.match(/^(\d+)(?:\.(\d+))?(?:[.-](\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2] ?? '0', 10),
    patch: parseInt(m[3] ?? '0', 10),
  }
}

/** model_number から family を推定 */
export function inferFamily(modelNumber: string): string {
  const m = modelNumber.toUpperCase()
  if (m.startsWith('WJ-NX'))  return 'nx'
  if (m.startsWith('WJ-NU'))  return 'nu'
  if (m.startsWith('WJ-GXE')) return 'gxe'
  if (m.startsWith('WJ-HD'))  return 'hd'
  return 'unknown'
}

/** Server ヘッダー値から family を推定 (最終 fallback) */
function inferFamilyFromServer(server: string): string {
  if (/WJ-NX/i.test(server)) return 'nx'
  if (/WJ-NU/i.test(server)) return 'nu'
  if (/WJ-GXE/i.test(server)) return 'gxe'
  return 'unknown'
}

// ─── ONVIF GetDeviceInformation (簡易実装) ───────────────────────────────────

/**
 * ONVIF GetDeviceInformation を呼ぶ。
 * 実装は最小限の SOAP POST のみ。完全な ONVIF クライアントは Phase 1 で
 * `node-onvif` 等のライブラリに置き換え予定。
 */
async function detectViaOnvif(
  opts: DetectFirmwareOptions,
): Promise<Omit<FirmwareInfo, 'detectedAt' | 'source'> | null> {
  const onvifUrl = `${opts.endpoint.replace(/\/+$/, '')}/onvif/device_service`
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>
  </s:Body>
</s:Envelope>`

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 5000)
  try {
    const auth = 'Basic ' + Buffer.from(
      `${opts.credentials.username}:${opts.credentials.password}`,
    ).toString('base64')
    const res = await fetch(onvifUrl, {
      method:  'POST',
      headers: {
        'content-type':  'application/soap+xml; charset=utf-8',
        'authorization': auth,
      },
      body:    soap,
      signal:  ctl.signal,
    })
    if (!res.ok) return null
    const xml = await res.text()
    // 雑に正規表現でパース (実用は Phase 1 で proper XML parser に置換)
    const model    = xml.match(/<(?:tds:)?Model>([^<]+)<\/(?:tds:)?Model>/)?.[1]
    const fwVer    = xml.match(/<(?:tds:)?FirmwareVersion>([^<]+)<\/(?:tds:)?FirmwareVersion>/)?.[1]
    const serial   = xml.match(/<(?:tds:)?SerialNumber>([^<]+)<\/(?:tds:)?SerialNumber>/)?.[1]
    const hwVer    = xml.match(/<(?:tds:)?HardwareId>([^<]+)<\/(?:tds:)?HardwareId>/)?.[1]
    if (!model || !fwVer) return null
    const { major, minor, patch } = parseSemver(fwVer)
    return {
      vendor:       'i-pro',
      modelFamily:  inferFamily(model),
      modelNumber:  model,
      fwVersion:    fwVer,
      fwMajor:      major,
      fwMinor:      minor,
      fwPatch:      patch,
      hwVersion:    hwVer,
      serial,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
