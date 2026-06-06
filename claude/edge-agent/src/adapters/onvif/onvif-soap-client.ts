/**
 * F52.A: ONVIF SOAP 最小クライアント
 *
 * 完全な ONVIF SDK (node-onvif 等) を持ち込まず、必要な操作だけ自前実装。
 * 依存追加を避けつつ、HTTP POST + 簡易 XML パースで十分。
 *
 * サポートする SOAP アクション:
 *   - GetDeviceInformation        (FW 検出)
 *   - GetSnapshotUri (Media1)     (snapshot URL 取得)
 *   - GetStreamUri  (Media1)      (RTSP URL 取得)
 *   - CreatePullPointSubscription (event 購読 — Phase 6 で利用予定)
 *
 * 認証: WS-Security UsernameToken (デジタル平文) を使用。
 *      Digest WSSE は実装複雑なので Phase 6 で対応予定。
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

  /** Media1 経由のプロファイル一覧取得 (channel 列挙の素材) */
  async getProfiles(): Promise<Array<{ token: string; name: string }>> {
    const xml = await this.callMedia(`<trt:GetProfiles/>`)
    // 雑な regex パース: <trt:Profiles token="..."> ... <tt:Name>...</tt:Name>
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
    return this.doCall(`${this.endpoint}/onvif/Media`, body, { trt: NS_TRT })
  }

  private async doCall(
    url:  string,
    body: string,
    ns:   Record<string, string>,
  ): Promise<string> {
    const wsse = this.buildWsseHeader()
    const nsAttrs = Object.entries(ns).map(([k, v]) => `xmlns:${k}="${v}"`).join(' ')
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${NS_S}" ${nsAttrs}>
  <s:Header>${wsse}</s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`

    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: {
          'content-type': 'application/soap+xml; charset=utf-8',
        },
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
   * 仕様: OASIS WS-Security 1.1 UsernameToken Profile
   *   PasswordDigest = base64(sha1(nonce + created + password))
   */
  private buildWsseHeader(): string {
    const nonce   = randomBytes(16)
    const created = new Date().toISOString()
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
    // <tds:Tag>value</tds:Tag> or <tt:Tag>value</tt:Tag> 等のプレフィックス付きをまとめて吸収
    const re = new RegExp(`<(?:[a-z]+:)?${tag}>([^<]*)</(?:[a-z]+:)?${tag}>`)
    const m = xml.match(re)
    if (!m) {
      if (optional) return ''
      throw new Error(`ONVIF response missing <${tag}>: ${xml.slice(0, 200)}`)
    }
    return m[1]
  }
}
