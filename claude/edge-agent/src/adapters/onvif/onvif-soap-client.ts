/**
 * F52.A: ONVIF SOAP 最小クライアント
 *
 * 完全な ONVIF SDK (node-onvif 等) を持ち込まず、必要な操作だけ自前実装。
 * 依存追加を避けつつ、HTTP POST + 簡易 XML パースで十分。
 *
 * サポートする SOAP アクション:
 *   - GetSystemDateAndTime        (時刻同期 = WS-Security clock skew 対策)
 *   - GetDeviceInformation        (FW 検出)
 *   - GetCapabilities (Media)     (Media サービス XAddr の発見)
 *   - GetProfiles    (Media1)     (channel 列挙)
 *   - GetSnapshotUri (Media1)     (snapshot URL 取得)
 *   - GetStreamUri   (Media1)     (RTSP URL 取得)
 *
 * 認証: WS-Security UsernameToken (PasswordDigest)。
 *
 * 2026-06-19 実機(i-PRO WJ-NU101 配下カメラ)スパイクで判明した実態に対応:
 *   1. Media サービスは `/onvif/Media` ではなく `/onvif/media_service`。
 *      → GetCapabilities で XAddr を発見し、失敗時は media_service にフォールバック。
 *   2. WS-Security の Created は端末時刻ではなく **機器時刻**に合わせる必要がある
 *      (skew が大きいと NotAuthorized)。→ GetSystemDateAndTime でオフセットを測る。
 *   詳細: docs/spike-ipro-nu-result.md / docs/onvif-adapter-design.md
 */
import { createHash, randomBytes } from 'crypto'

export interface OnvifClientOptions {
  endpoint:   string                 // 'https://10.0.1.5:8443'
  username:   string
  password:   string
  timeoutMs?: number
}

export interface OnvifDeviceInfo {
  manufacturer:    string
  model:           string
  firmwareVersion: string
  serialNumber?:   string
  hardwareId?:     string
}

const NS_S    = 'http://www.w3.org/2003/05/soap-envelope'
const NS_TDS  = 'http://www.onvif.org/ver10/device/wsdl'
const NS_TRT  = 'http://www.onvif.org/ver10/media/wsdl'

export class OnvifSoapClient {
  private readonly endpoint: string
  private readonly username: string
  private readonly password: string
  private readonly timeoutMs: number

  /** GetCapabilities で発見した Media サービス URL (キャッシュ) */
  private mediaUrl:    string | null = null
  /** 機器時刻 − 端末時刻 (ms)。WS-Security の Created に加算する */
  private timeOffsetMs = 0
  private timeSynced    = false

  constructor(opts: OnvifClientOptions) {
    this.endpoint  = opts.endpoint.replace(/\/+$/, '')
    this.username  = opts.username
    this.password  = opts.password
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  /** デバイス情報 (FW 検出に使う) */
  async getDeviceInformation(): Promise<OnvifDeviceInfo> {
    const xml = await this.callDevice(`<tds:GetDeviceInformation/>`)
    return {
      manufacturer:    this.extractTag(xml, 'Manufacturer'),
      model:           this.extractTag(xml, 'Model'),
      firmwareVersion: this.extractTag(xml, 'FirmwareVersion'),
      serialNumber:    this.extractTag(xml, 'SerialNumber', true),
      hardwareId:      this.extractTag(xml, 'HardwareId', true),
    }
  }

  /**
   * 機器の現在時刻 (UTC) を取得。認証不要・WS-Security 無しで呼べる。
   * 取得できなければ null。
   */
  async getSystemDateAndTime(): Promise<Date | null> {
    const envelope = this.buildEnvelope(`<tds:GetSystemDateAndTime/>`, `xmlns:tds="${NS_TDS}"`)
    let xml: string
    try {
      xml = await this.rawPost(`${this.endpoint}/onvif/device_service`, envelope)
    } catch {
      return null
    }
    const utc = xml.match(/<(?:[a-z0-9]+:)?UTCDateTime>([\s\S]*?)<\/(?:[a-z0-9]+:)?UTCDateTime>/i)?.[1]
    if (!utc) return null
    const g = (t: string): number =>
      Number((utc.match(new RegExp(`<(?:[a-z0-9]+:)?${t}>(\\d+)`, 'i')) ?? [])[1])
    const year = g('Year')
    if (!year) return null
    return new Date(Date.UTC(year, g('Month') - 1, g('Day'), g('Hour'), g('Minute'), g('Second')))
  }

  /** Media1 経由のプロファイル一覧取得 (channel 列挙の素材) */
  async getProfiles(): Promise<Array<{ token: string; name: string }>> {
    const xml = await this.callMedia(`<trt:GetProfiles/>`)
    const profiles: Array<{ token: string; name: string }> = []
    const re = /<(?:trt:)?Profiles\s+[^>]*token="([^"]+)"[^>]*>([\s\S]*?)<\/(?:trt:)?Profiles>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml))) {
      const token = m[1]
      const inner = m[2]
      const name = (inner.match(/<(?:tt:)?Name>([^<]+)<\/(?:tt:)?Name>/) ?? [])[1] ?? token
      profiles.push({ token, name })
    }
    return profiles
  }

  /** スナップショット URI 取得 */
  async getSnapshotUri(profileToken: string): Promise<string> {
    const xml = await this.callMedia(
      `<trt:GetSnapshotUri><trt:ProfileToken>${profileToken}</trt:ProfileToken></trt:GetSnapshotUri>`,
    )
    return this.extractTag(xml, 'Uri')
  }

  /** ストリーム URI 取得 (RTSP) */
  async getStreamUri(profileToken: string, protocol: 'RTSP' = 'RTSP'): Promise<string> {
    const xml = await this.callMedia(
      `<trt:GetStreamUri>
         <trt:StreamSetup>
           <tt:Stream xmlns:tt="http://www.onvif.org/ver10/schema">RTP-Unicast</tt:Stream>
           <tt:Transport xmlns:tt="http://www.onvif.org/ver10/schema">
             <tt:Protocol>${protocol}</tt:Protocol>
           </tt:Transport>
         </trt:StreamSetup>
         <trt:ProfileToken>${profileToken}</trt:ProfileToken>
       </trt:GetStreamUri>`,
    )
    return this.extractTag(xml, 'Uri')
  }

  // ─── 内部 ───────────────────────────────────────────────────────────────

  private async callDevice(body: string): Promise<string> {
    return this.doCall(`${this.endpoint}/onvif/device_service`, body, { tds: NS_TDS })
  }

  private async callMedia(body: string): Promise<string> {
    return this.doCall(await this.resolveMediaUrl(), body, { trt: NS_TRT })
  }

  /**
   * Media サービス URL を解決。GetCapabilities の Media XAddr を優先し、
   * 取れなければ i-PRO 実機で確認済みの `/onvif/media_service` にフォールバック。
   * (旧実装の `/onvif/Media` は i-PRO で 404 になる)
   */
  private async resolveMediaUrl(): Promise<string> {
    if (this.mediaUrl) return this.mediaUrl
    try {
      const xml = await this.callDevice(
        `<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>`,
      )
      const m = xml.match(
        /<(?:[a-z0-9]+:)?Media\b[\s\S]*?<(?:[a-z0-9]+:)?XAddr>([^<]+)<\/(?:[a-z0-9]+:)?XAddr>/i,
      )
      if (m && m[1]) {
        this.mediaUrl = m[1].trim()
        return this.mediaUrl
      }
    } catch {
      // フォールバックへ
    }
    this.mediaUrl = `${this.endpoint}/onvif/media_service`
    return this.mediaUrl
  }

  /** 認証付き SOAP 呼び出し (時刻同期 → WS-Security 付与) */
  private async doCall(
    url:  string,
    body: string,
    ns:   Record<string, string>,
  ): Promise<string> {
    await this.ensureTimeSynced()
    const nsAttrs = Object.entries(ns).map(([k, v]) => `xmlns:${k}="${v}"`).join(' ')
    const envelope = this.buildEnvelope(body, nsAttrs, this.buildWsseHeader())
    return this.rawPost(url, envelope)
  }

  /** 機器時刻とのオフセットを一度だけ測る (失敗してもオフセット 0 で続行) */
  private async ensureTimeSynced(): Promise<void> {
    if (this.timeSynced) return
    this.timeSynced = true
    const deviceTime = await this.getSystemDateAndTime()
    if (deviceTime) this.timeOffsetMs = deviceTime.getTime() - Date.now()
  }

  private buildEnvelope(body: string, nsAttrs: string, wsseHeader = ''): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${NS_S}" ${nsAttrs}>
  <s:Header>${wsseHeader}</s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`
  }

  private async rawPost(url: string, envelope: string): Promise<string> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
        body:    envelope,
        signal:  ctl.signal,
      })
      const text = await res.text()
      if (!res.ok) {
        throw new Error(`ONVIF HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      return text
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * WS-Security UsernameToken Digest 形式のヘッダを生成。
   *   PasswordDigest = base64(sha1(nonce + created + password))
   * Created は機器時刻オフセットを反映する (clock skew 対策)。
   */
  private buildWsseHeader(): string {
    const nonce   = randomBytes(16)
    const created = new Date(Date.now() + this.timeOffsetMs).toISOString()
    const sha1    = createHash('sha1')
    sha1.update(nonce)
    sha1.update(created)
    sha1.update(this.password)
    const digest  = sha1.digest('base64')
    const nonceB64 = nonce.toString('base64')

    return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <wsse:UsernameToken>
    <wsse:Username>${this.escape(this.username)}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
    <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
    <wsu:Created xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</wsu:Created>
  </wsse:UsernameToken>
</wsse:Security>`
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private extractTag(xml: string, tag: string, optional = false): string {
    const re = new RegExp(`<(?:[a-z]+:)?${tag}>([^<]*)</(?:[a-z]+:)?${tag}>`)
    const m = xml.match(re)
    if (!m) {
      if (optional) return ''
      throw new Error(`ONVIF response missing <${tag}>: ${xml.slice(0, 200)}`)
    }
    return m[1]
  }
}

// ─── HTTP Digest ヘルパ (snapshot 取得が Basic でなく Digest を要求する機種向け) ──

export interface DigestChallenge {
  realm?: string; nonce?: string; qop?: string; opaque?: string; algorithm?: string
}

/** WWW-Authenticate: Digest ... ヘッダ値をパース */
export function parseDigestChallenge(header: string): DigestChallenge {
  const get = (k: string): string | undefined =>
    (header.match(new RegExp(`${k}="?([^",]+)"?`, 'i')) ?? [])[1]
  return {
    realm: get('realm'), nonce: get('nonce'), qop: get('qop'),
    opaque: get('opaque'), algorithm: get('algorithm'),
  }
}

/** HTTP Digest の Authorization ヘッダ値を生成 */
export function buildHttpDigest(
  method: string, urlStr: string, user: string, pass: string, ch: DigestChallenge,
): string {
  const url = new URL(urlStr)
  const uri = url.pathname + url.search
  const md5 = (s: string) => createHash('md5').update(s).digest('hex')
  const ha1 = md5(`${user}:${ch.realm}:${pass}`)
  const ha2 = md5(`${method}:${uri}`)
  const nc = '00000001'
  const cnonce = randomBytes(8).toString('hex')
  const qop = ch.qop?.split(',')[0]?.trim()
  const response = qop
    ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${ch.nonce}:${ha2}`)
  let s = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"`
  if (qop) s += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`
  if (ch.opaque) s += `, opaque="${ch.opaque}"`
  if (ch.algorithm) s += `, algorithm=${ch.algorithm}`
  return s
}
