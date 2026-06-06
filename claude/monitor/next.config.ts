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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.tile.openstreetmap.org' },
    ],
  },
}

export default config
