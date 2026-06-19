/**
 * i-PRO WJ-NU + カメラ 実機ディスカバリ・プローブ（ONVIF / CGI 並行）
 * ──────────────────────────────────────────────────────────────────────────
 * 背景: 未認証プローブで判明した実機の現実
 *   - NU101 NVR(192.168.0.250): HTTPSのみ・自己署名・Digest(realm "Network disk
 *     recorder")。/cgi-bin/getsysteminfo・snapshot.cgi・playback は 404（=WJ-NX規約と不一致）。
 *   - カメラ(101/102): ONVIF(/onvif/device_service) 生存・RTSP 554 生存。
 *
 * このツールの役割: 認証付きで「ONVIF」と「i-PRO CGI」の両方を叩き、実機で実際に
 *   通るエンドポイント（ライブ/スナップ/VOD=Profile-G）を実証して統合方式を確定する。
 *
 * 認証情報は claude/edge-agent/.env（git管理外）から読む。値はログにマスク表示。
 *   NVR_ENDPOINT=https://192.168.0.250
 *   NVR_USER=... NVR_PASS=...
 *   CAM_IPS=192.168.0.101,192.168.0.102
 *   CAM_USER=... CAM_PASS=...   （未設定なら NVR_* を流用）
 *
 * 実行: cd claude/edge-agent && bun run spike:ipro-discover
 */
import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 自己署名 HTTPS の LAN 機器を叩くためだけに TLS 検証を無効化（このプロセス限定・LAN探索用途）。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const NVR_ENDPOINT = (process.env.NVR_ENDPOINT ?? process.env.IPRO_ENDPOINT ?? 'https://192.168.0.250').replace(/\/+$/, '')
const NVR_USER = process.env.NVR_USER ?? process.env.IPRO_USER ?? ''
const NVR_PASS = process.env.NVR_PASS ?? process.env.IPRO_PASS ?? ''
const CAM_IPS = (process.env.CAM_IPS ?? '192.168.0.101,192.168.0.102').split(',').map((s) => s.trim()).filter(Boolean)
const CAM_USER = process.env.CAM_USER ?? NVR_USER
const CAM_PASS = process.env.CAM_PASS ?? NVR_PASS

if (!NVR_USER || !NVR_PASS) {
  console.error('ERROR: 認証情報がありません。claude/edge-agent/.env に NVR_USER / NVR_PASS（必要なら CAM_USER/CAM_PASS）を設定してください。')
  process.exit(2)
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = join(process.cwd(), 'spike-out', `discover-${ts}`)
mkdirSync(outDir, { recursive: true })

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const report: Record<string, unknown> = { when: ts, nvr: NVR_ENDPOINT, cameras: CAM_IPS, findings: {} }
const findings = report.findings as Record<string, unknown>

function mask(s: string): string {
  return s.replace(new RegExp(NVR_PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
          .replace(/\/\/[^@/]+@/g, '//<creds>@')
}

// ── HTTP Digest GET（任意パスを叩いて status/型/サイズを返す） ──────────────────
function parseChallenge(h: string) {
  const get = (k: string) => h.match(new RegExp(`${k}="?([^",]+)"?`, 'i'))?.[1]
  return { realm: get('realm'), nonce: get('nonce'), qop: get('qop'), opaque: get('opaque'), algorithm: get('algorithm') }
}
function digestHeader(method: string, urlStr: string, user: string, pass: string, ch: ReturnType<typeof parseChallenge>) {
  const url = new URL(urlStr)
  const uri = url.pathname + url.search
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
async function digestGet(base: string, path: string, user: string, pass: string) {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base).toString()
  try {
    const r1 = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
    if (r1.status !== 401) {
      const body = Buffer.from(await r1.arrayBuffer())
      return { url, status: r1.status, type: r1.headers.get('content-type'), bytes: body.length, snippet: r1.status === 200 ? body.subarray(0, 200).toString('latin1') : undefined }
    }
    const ch = parseChallenge(r1.headers.get('www-authenticate') ?? '')
    const r2 = await fetch(url, { method: 'GET', headers: { Authorization: digestHeader('GET', url, user, pass, ch) }, signal: AbortSignal.timeout(8000) })
    const body = Buffer.from(await r2.arrayBuffer())
    return { url, status: r2.status, type: r2.headers.get('content-type'), bytes: body.length, snippet: r2.status === 200 ? body.subarray(0, 200).toString('latin1') : undefined }
  } catch (e) {
    return { url, status: -1, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── ONVIF SOAP POST（WS-UsernameToken PasswordDigest 付き） ──────────────────
function wsSecurity(user: string, pass: string): string {
  const nonce = randomBytes(16)
  const created = new Date(Date.now() - 60_000).toISOString() // 端末時刻ずれ対策で少し過去
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(pass)])).digest('base64')
  return `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">`
    + `<UsernameToken><Username>${user}</Username>`
    + `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>`
    + `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>`
    + `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>`
    + `</UsernameToken></Security></s:Header>`
}
function soapEnvelope(bodyXml: string, sec?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">`
    + (sec ?? '') + `<s:Body xmlns="http://www.onvif.org/ver10/device/wsdl">${bodyXml}</s:Body></s:Envelope>`
}
async function onvifCall(serviceUrl: string, action: string, innerXml: string, auth?: { user: string; pass: string }) {
  const sec = auth ? wsSecurity(auth.user, auth.pass) : undefined
  const body = soapEnvelope(innerXml, sec)
  try {
    const r = await fetch(serviceUrl, {
      method: 'POST',
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"` },
      body,
      signal: AbortSignal.timeout(8000),
    })
    const text = await r.text()
    return { status: r.status, ok: r.ok, text }
  } catch (e) {
    return { status: -1, ok: false, text: e instanceof Error ? e.message : String(e) }
  }
}
function extract(re: RegExp, text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

// ── RTSP DESCRIBE（digest）で SDP/コーデック確認 ──────────────────────────────
function rtspDescribe(ip: string, port: number, path: string, user: string, pass: string): Promise<{ status: number; sdp?: string; error?: string }> {
  return new Promise((resolve) => {
    const url = `rtsp://${ip}:${port}${path}`
    const sock = connect({ host: ip, port, timeout: 6000 })
    let buf = ''
    let phase: 'first' | 'auth' = 'first'
    const send = (auth?: string) => {
      sock.write(`DESCRIBE ${url} RTSP/1.0\r\nCSeq: ${phase === 'first' ? 1 : 2}\r\nAccept: application/sdp\r\n${auth ? `Authorization: ${auth}\r\n` : ''}\r\n`)
    }
    sock.on('connect', () => send())
    sock.on('data', (d) => {
      buf += d.toString('latin1')
      if (!buf.includes('\r\n\r\n')) return
      const statusLine = buf.split('\r\n')[0]
      const code = Number(statusLine.split(' ')[1])
      if (code === 401 && phase === 'first') {
        const ch = parseChallenge(buf.match(/WWW-Authenticate:\s*Digest\s*(.+)/i)?.[1] ?? '')
        phase = 'auth'; buf = ''
        send(digestHeader('DESCRIBE', url, user, pass, ch))
        return
      }
      const sdp = buf.includes('v=0') ? buf.slice(buf.indexOf('v=0')) : undefined
      sock.destroy()
      resolve({ status: code, sdp })
    })
    sock.on('timeout', () => { sock.destroy(); resolve({ status: -1, error: 'timeout' }) })
    sock.on('error', (e) => resolve({ status: -1, error: e.message }))
  })
}

// ── 実行本体 ────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(72))
  console.log(`実機ディスカバリ  NVR=${NVR_ENDPOINT}  cameras=${CAM_IPS.join(',')}`)
  console.log(`出力: ${outDir}`)
  console.log('═'.repeat(72))

  // ── A. NVR の i-PRO CGI 候補パス（認証付き） ──────────────────────────────
  console.log('\n[A] NVR CGI 候補パス（200=実在 / 404=パス違い / 401=認証要）')
  const cgiCandidates = [
    '/cgi-bin/getsysteminfo', '/cgi-bin/get_systeminfo', '/cgi-bin/getinfo',
    '/cgi-bin/cam', '/cgi-bin/camera', '/cgi-bin/snapshot.cgi?ch=1', '/cgi-bin/snapshot?ch=1',
    '/cgi-bin/getstream?ch=1', '/cgi-bin/nphMotionJpeg?ch=1',
    '/cgi-bin/playback?ch=1', '/cgi-bin/getrecinfo', '/cgi-bin/recsearch', '/cgi-bin/event_search',
    '/cgi-bin/getdiskinfo', '/cgi-bin/getconfig', '/cgi-bin/version.cgi',
  ]
  const cgiResults = []
  for (const p of cgiCandidates) {
    const r = await digestGet(NVR_ENDPOINT, p, NVR_USER, NVR_PASS)
    cgiResults.push(r)
    console.log(`  [${r.status}] ${p}${r.type ? ` (${r.type}, ${r.bytes}B)` : ''}${r.error ? ' ' + mask(r.error) : ''}`)
  }
  findings.nvrCgi = cgiResults

  // ── B. NVR ONVIF（別ポート/パス + Profile-G 探索） ────────────────────────
  console.log('\n[B] NVR ONVIF（device_service の所在 / Recording・Replay=Profile-G）')
  const onvifBases = [`${NVR_ENDPOINT}/onvif/device_service`, `http://${new URL(NVR_ENDPOINT).hostname}/onvif/device_service`]
  const nvrOnvif = []
  for (const url of onvifBases) {
    const r = await onvifCall(url, 'http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime', '<GetSystemDateAndTime/>')
    nvrOnvif.push({ url, status: r.status, ok: r.text.includes('SystemDateAndTime') })
    console.log(`  [${r.status}] ${url}  GetSystemDateAndTime:${r.text.includes('SystemDateAndTime') ? 'OK' : 'NG'}`)
    if (r.status === 200) {
      const caps = await onvifCall(url, 'http://www.onvif.org/ver10/device/wsdl/GetServices', '<GetServices><IncludeCapability>true</IncludeCapability></GetServices>', { user: NVR_USER, pass: NVR_PASS })
      writeFileSync(join(outDir, 'nvr-onvif-services.xml'), caps.text)
      const xaddrs = extract(/<[^>]*XAddr>([^<]+)</g, caps.text)
      const hasReplay = /Replay/i.test(caps.text)
      const hasRecording = /Recording/i.test(caps.text)
      console.log(`    GetServices:[${caps.status}] Replay(Profile-G):${hasReplay} Recording:${hasRecording}`)
      console.log(`    XAddrs: ${xaddrs.map(mask).join(' , ') || '(none)'}`)
      nvrOnvif.push({ getServices: caps.status, hasReplay, hasRecording, xaddrs })
    }
  }
  findings.nvrOnvif = nvrOnvif

  // ── C. カメラ ONVIF（Profile-S: GetProfiles→GetStreamUri） ────────────────
  console.log('\n[C] カメラ ONVIF（Profile-S ライブ）+ RTSP DESCRIBE')
  const camResults = []
  for (const ip of CAM_IPS) {
    const dev = `http://${ip}/onvif/device_service`
    const probe = await onvifCall(dev, 'http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime', '<GetSystemDateAndTime/>')
    console.log(`  -- ${ip} -- device_service:[${probe.status}] alive:${probe.text.includes('SystemDateAndTime')}`)
    const entry: Record<string, unknown> = { ip, deviceServiceStatus: probe.status }

    // Media service を取得（GetCapabilities）
    const caps = await onvifCall(dev, 'http://www.onvif.org/ver10/device/wsdl/GetCapabilities', '<GetCapabilities><Category>All</Category></GetCapabilities>', { user: CAM_USER, pass: CAM_PASS })
    const mediaXAddr = caps.text.match(/<[^>]*Media[^>]*>[\s\S]*?XAddr>([^<]+)</)?.[1] ?? `http://${ip}/onvif/media_service`
    entry.mediaXAddr = mask(mediaXAddr)

    // GetProfiles → 最初の token → GetStreamUri(RTSP)
    const profilesXml = soapEnvelope('<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>', wsSecurity(CAM_USER, CAM_PASS))
    let rtspUri: string | undefined
    try {
      const pr = await fetch(mediaXAddr, { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: profilesXml, signal: AbortSignal.timeout(8000) })
      const pt = await pr.text()
      const token = pt.match(/token="([^"]+)"/)?.[1]
      entry.profileToken = token
      if (token) {
        const streamXml = soapEnvelope(
          `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup xmlns="http://www.onvif.org/ver10/schema"><Stream>RTP-Unicast</Stream><Transport><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>${token}</ProfileToken></GetStreamUri>`,
          wsSecurity(CAM_USER, CAM_PASS),
        )
        const sr = await fetch(mediaXAddr, { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: streamXml, signal: AbortSignal.timeout(8000) })
        const st = await sr.text()
        rtspUri = st.match(/<[^>]*Uri>([^<]+)</)?.[1]
        entry.streamUri = rtspUri ? mask(rtspUri) : undefined
      }
    } catch (e) {
      entry.onvifMediaError = e instanceof Error ? e.message : String(e)
    }
    console.log(`     Media:${entry.mediaXAddr}  StreamUri:${entry.streamUri ?? '(取得失敗)'}`)

    // RTSP DESCRIBE（ONVIFが返したパス、無ければ既定パスを試す）
    const rtspPath = rtspUri ? new URL(rtspUri).pathname + new URL(rtspUri).search : '/MediaInput/h264/stream_1'
    const rtspPort = rtspUri ? Number(new URL(rtspUri).port || 554) : 554
    const d = await rtspDescribe(ip, rtspPort, rtspPath, CAM_USER, CAM_PASS)
    const codec = d.sdp?.match(/a=rtpmap:\d+\s+([A-Za-z0-9]+)/)?.[1]
    entry.rtsp = { status: d.status, codec, error: d.error }
    console.log(`     RTSP DESCRIBE [${d.status}] codec:${codec ?? '-'}${d.error ? ' ' + d.error : ''}`)
    camResults.push(entry)
  }
  findings.cameras = camResults

  // ── サマリ ───────────────────────────────────────────────────────────────
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\n' + '═'.repeat(72))
  console.log('統合方式の判定材料')
  console.log('═'.repeat(72))
  const cgiOk = cgiResults.filter((r) => r.status === 200).map((r) => new URL(r.url).pathname)
  console.log(`NVR CGI 実在(200): ${cgiOk.length ? cgiOk.join(', ') : 'なし → CGI方式は不可/要i-PRO仕様書'}`)
  const replay = (findings.nvrOnvif as Array<Record<string, unknown>>).some((x) => x.hasReplay)
  console.log(`NVR ONVIF Profile-G(Replay): ${replay ? 'あり → VODをONVIFで取得可能' : 'なし/未到達 → VOD経路は要再検討'}`)
  for (const c of camResults as Array<Record<string, unknown>>) {
    const rtsp = c.rtsp as { status: number; codec?: string }
    console.log(`カメラ ${c.ip}: ライブRTSP ${rtsp.status === 200 ? `OK(${rtsp.codec})` : 'NG'} / StreamUri ${c.streamUri ? 'OK' : 'NG'}`)
  }
  console.log(`\nレポート: ${join(outDir, 'report.json')}`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
