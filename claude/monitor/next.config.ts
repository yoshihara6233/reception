import type { NextConfig } from 'next'
import { join } from 'path'

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
  // A4: 巡回レポート PDF 生成 cron が同梱フォント(OTF)を実行時に読むため、
  // serverless バンドルにフォントを含める（未指定だと本番で ENOENT）。
  outputFileTracingIncludes: {
    '/api/cron/security-report': ['./fonts/**'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.tile.openstreetmap.org' },
    ],
  },
}

export default config
