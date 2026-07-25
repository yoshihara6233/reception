import type { NextConfig } from 'next'
import { join } from 'path'

// PDF(pdfkit)ルートに同梱する素材の glob。outputFileTracingRoot=monorepoルート基準
// を主とし、app(claude/monitor)基準の旧表記も残して root 差異を両取りする。
const PDF_ASSETS = [
  // ── monorepo ルート基準（本命）──
  'claude/monitor/fonts/**',
  'node_modules/.bun/pdfkit@*/node_modules/pdfkit/js/data/**',
  'node_modules/pdfkit/js/data/**',
  // ── app 基準（旧・保険）──
  './fonts/**',
  './node_modules/pdfkit/js/data/**',
  '../../node_modules/.bun/pdfkit@*/node_modules/pdfkit/js/data/**',
]

const config: NextConfig = {
  reactStrictMode: true,
  // F46.1: モノレポ化に伴い workspace root を明示。
  // ルート (= 2 つ上) を turbopack の探索ルートに固定し、
  // "Next.js inferred your workspace root" 警告を抑止する。
  turbopack: {
    root: join(__dirname, '..', '..'),
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // PDF 生成（pdfkit＋同梱Noto）が実行時に readFileSync する素材を serverless バンドルへ強制同梱。
  //  1) 同梱日本語フォント(OTF)
  //  2) pdfkit の標準フォント metrics(js/data/*.afm) — pdfkit が動的 readFileSync するため
  //     静的トレースから漏れ、未指定だと本番で ENOENT: Helvetica.afm。
  // 【重要】outputFileTracingRoot は bun.lock のある **monorepo ルート**（= /ROOT）に推論される。
  //   ランタイムの実体パスは /ROOT/node_modules/.bun/pdfkit@x/.../js/data/Helvetica.afm。
  //   よって glob は **ルート基準**で書く（fonts は claude/monitor/fonts/**、pdfkit は
  //   node_modules/.bun/...）。旧・app基準(./…)も無害なので残し、root 差異を両取りする。
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: {
    '/api/cron/security-report': PDF_ASSETS,
    '/security':                 PDF_ASSETS,
    '/api/admin/reports/monthly': PDF_ASSETS,
    '/api/cron/monthly-report':   PDF_ASSETS,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.tile.openstreetmap.org' },
    ],
  },
}

export default config
