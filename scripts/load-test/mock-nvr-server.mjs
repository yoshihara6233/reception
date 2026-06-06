#!/usr/bin/env node
/**
 * F50.D: モック NVR HTTP サーバ
 *
 * i-PRO WJ-NX/NU の CGI と ONVIF を模した最小実装。
 * - GET  /cgi-bin/getsysteminfo       → FW Ver 等を返す (Digest 認証)
 * - GET  /cgi-bin/snapshot.cgi?ch=N   → 適当な JPEG を返す
 * - POST /onvif/device_service        → ONVIF SOAP レスポンス
 *
 * Usage:
 *   # 単一ポート起動 (デフォルト)
 *   node scripts/load-test/mock-nvr-server.mjs --port=8443
 *
 *   # 複数ポート (1000 NVR 模擬: 18443 ～ 19442)
 *   node scripts/load-test/mock-nvr-server.mjs --multi=1000 --base-port=18443
 *
 *   # FW Ver / model を上書き
 *   node scripts/load-test/mock-nvr-server.mjs --model=WJ-NX300K --fw=3.42-0001
 *
 *   # 故意に遅延 (latency simulation)
 *   node scripts/load-test/mock-nvr-server.mjs --latency-ms=200
 *
 *   # 一定確率で失敗 (chaos)
 *   node scripts/load-test/mock-nvr-server.mjs --fail-rate=0.1
 */
import { createServer } from 'http'
import process from 'process'

const args = process.argv.slice(2)
const opts = {
  port:       8443,
  multi:      1,
  basePort:   8443,
  model:      'WJ-NX300K',
  fw:         '3.42-0001',
  latencyMs:  0,
  failRate:   0,
}
let portExplicit = false
let basePortExplicit = false
for (const a of args) {
  if (a.startsWith('--port='))       { opts.port = parseInt(a.slice(7), 10); portExplicit = true }
  else if (a.startsWith('--multi=')) opts.multi = parseInt(a.slice(8), 10)
  else if (a.startsWith('--base-port=')) { opts.basePort = parseInt(a.slice(12), 10); basePortExplicit = true }
  else if (a.startsWith('--model='))     opts.model = a.slice(8)
  else if (a.startsWith('--fw='))        opts.fw = a.slice(5)
  else if (a.startsWith('--latency-ms='))opts.latencyMs = parseInt(a.slice(13), 10)
  else if (a.startsWith('--fail-rate=')) opts.failRate = parseFloat(a.slice(12))
}
// --port を指定したら basePort にコピー (シングルポートユースケース)
if (portExplicit && !basePortExplicit) opts.basePort = opts.port

// ── 最小 JPEG (8x8 黒) — Header + dummy data ──
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  // 残りは適当な JPEG 終端
  0xff, 0xd9,
])

const ONVIF_RESPONSE_TEMPLATE = (model, fw) => `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>i-PRO</tds:Manufacturer>
      <tds:Model>${model}</tds:Model>
      <tds:FirmwareVersion>${fw}</tds:FirmwareVersion>
      <tds:SerialNumber>MOCK-${Date.now()}</tds:SerialNumber>
      <tds:HardwareId>2.10</tds:HardwareId>
    </tds:GetDeviceInformationResponse>
  </s:Body>
</s:Envelope>`

function makeHandler() {
  return async (req, res) => {
    // chaos: 失敗率
    if (opts.failRate > 0 && Math.random() < opts.failRate) {
      res.writeHead(503); res.end('chaos-injected failure'); return
    }
    // latency simulation
    if (opts.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, opts.latencyMs))
    }

    const url = new URL(req.url ?? '/', 'http://localhost')

    // ── /cgi-bin/getsysteminfo ──
    if (url.pathname === '/cgi-bin/getsysteminfo') {
      // Digest auth 簡易対応: 認証ヘッダが無ければ challenge を返す
      const auth = req.headers.authorization
      if (!auth) {
        res.writeHead(401, {
          'www-authenticate':
            `Digest realm="i-PRO", nonce="${Date.now()}", qop="auth"`,
        })
        res.end()
        return
      }
      // 簡易: ユーザ名一致だけ確認 (本実装は username + password から hash 検証)
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(
        `ModelName=${opts.model}\r\n` +
        `FirmwareVersion=${opts.fw}\r\n` +
        `SerialNumber=MOCK${process.pid}\r\n` +
        `HardwareVersion=2.10\r\n` +
        `MacAddress=00:80:F0:00:00:01\r\n`,
      )
      return
    }

    // ── /cgi-bin/snapshot.cgi ──
    if (url.pathname === '/cgi-bin/snapshot.cgi') {
      res.writeHead(200, {
        'content-type':   'image/jpeg',
        'content-length': TINY_JPEG.length.toString(),
      })
      res.end(TINY_JPEG)
      return
    }

    // ── /onvif/device_service ──
    if (url.pathname === '/onvif/device_service' && req.method === 'POST') {
      const text = ONVIF_RESPONSE_TEMPLATE(opts.model, opts.fw)
      res.writeHead(200, { 'content-type': 'application/soap+xml; charset=utf-8' })
      res.end(text)
      return
    }

    res.writeHead(404); res.end('not found')
  }
}

// ── サーバ起動 ──
const handler = makeHandler()
const servers = []
const startTime = Date.now()
let bound = 0
for (let i = 0; i < opts.multi; i++) {
  const port = opts.basePort + i
  const srv = createServer(handler)
  srv.on('error', (err) => {
    console.error(`port ${port}: ${err.message}`)
  })
  srv.listen(port, '127.0.0.1', () => {
    bound++
    if (bound === opts.multi) {
      const elapsed = Date.now() - startTime
      console.log(`Mock NVR ready: ${opts.multi} server(s), port ${opts.basePort}…${opts.basePort + opts.multi - 1} (boot ${elapsed}ms)`)
      console.log(`Model: ${opts.model} / FW: ${opts.fw} / latency=${opts.latencyMs}ms / failRate=${opts.failRate}`)
      console.log(`Test:  curl -u admin:pass http://127.0.0.1:${opts.basePort}/cgi-bin/getsysteminfo`)
    }
  })
  servers.push(srv)
}

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received, closing ${servers.length} server(s)...`)
    Promise.all(servers.map((s) => new Promise((res) => s.close(res))))
      .then(() => process.exit(0))
  })
}
