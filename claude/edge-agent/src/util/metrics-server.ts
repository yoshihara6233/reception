/**
 * F50.C: Prometheus /metrics HTTP エンドポイント
 *
 * edge-agent プロセス内に最小限の HTTP サーバを建てて、
 * `/metrics` GET で Prometheus テキスト形式を返す。
 *
 * 起動方法:
 *   startMetricsServer({ port: 9464 })
 *
 * Prometheus 側 scrape_configs 例:
 *   - job_name: 'intereco-edge-central'
 *     static_configs:
 *       - targets: ['edge-central-01.intereco.jp:9464']
 */
import { createServer, type Server } from 'http'
import { registry } from './metrics'
import { logger } from '../logger.js'

export interface MetricsServerOptions {
  port?:        number
  host?:        string
}

let server: Server | null = null

export function startMetricsServer(opts: MetricsServerOptions = {}): Server {
  if (server) return server
  const port = opts.port ?? 9464
  const host = opts.host ?? '0.0.0.0'

  server = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400); res.end('bad request'); return
    }
    if (req.url === '/metrics' || req.url.startsWith('/metrics?')) {
      const text = registry.serialize()
      res.writeHead(200, {
        'content-type':   'text/plain; version=0.0.4; charset=utf-8',
        'content-length': Buffer.byteLength(text).toString(),
      })
      res.end(text)
      return
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(404); res.end('not found')
  })

  server.listen(port, host, () => {
    logger.info({ port, host }, 'metrics server listening')
  })

  server.on('error', (err) => {
    logger.error({ err: err.message }, 'metrics server error')
  })

  return server
}

export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(() => {
      server = null
      resolve()
    })
  })
}
