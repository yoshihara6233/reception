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
  // 巡回レポート PDF 生成が実行時に読むファイルを serverless バンドルへ強制同梱。
  //  1) 同梱日本語フォント(OTF)
  //  2) pdfkit の標準フォント metrics(js/data/*.afm) — pdfkit が動的 readFileSync
  //     するため静的トレースから漏れ、未指定だと本番で ENOENT: Helvetica.afm。
  //     node_modules/pdfkit は monorepo ルート .bun 実体への symlink なので、
  //     symlink 経路と実体経路の両方を指定して取りこぼしを防ぐ。
  // 対象は日次 cron と /security の server action(generateRunReportPdf)の両方。
  outputFileTracingIncludes: {
    '/api/cron/security-report': [
      './fonts/**',
      './node_modules/pdfkit/js/data/**',
      '../../node_modules/.bun/pdfkit@*/node_modules/pdfkit/js/data/**',
    ],
    '/security': [
      './fonts/**',
      './node_modules/pdfkit/js/data/**',
      '../../node_modules/.bun/pdfkit@*/node_modules/pdfkit/js/data/**',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.tile.openstreetmap.org' },
    ],
  },
}

export default config
