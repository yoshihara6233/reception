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

/**
 * 全応答に付ける HTTP セキュリティヘッダー。
 *
 * 映像・顔写真・証跡を扱うので、クリックジャッキング・MIME 誤解釈・
 * 外部への Referer 漏れは明示的に塞ぐ。
 *
 * ⚠ **実際に使っている機能を塞がないこと。**
 *   ・`camera=(self)`  — iPad キオスクの顔撮影が getUserMedia を使う
 *                        （src/lib/camera/capture.ts）。`camera=()` にすると
 *                        手荷物検査が動かなくなる。
 *   ・`X-Frame-Options: SAMEORIGIN` — DENY ではなく SAMEORIGIN。攻撃者のページは
 *                        cross-origin なのでどちらでも防げる。自前の同一オリジン
 *                        埋め込みを壊す危険だけを避ける。
 *   ・`frame-src` は **指定しない** — ライブ表示は Frigate の UI を
 *                        レコーダの LAN URL から iframe で読み込む
 *                        （live-player.tsx の 'iframe' モード）。制限すると
 *                        高画質ライブが表示できなくなる。
 *
 * CSP は `script-src` / `style-src` を含めていない。App Router で inline script に
 * nonce を通す配線が要るうえ、外し方を誤ると**画面が白くなる**。ここでは nonce 不要で
 * 副作用の無い指令だけ入れ、script/style の制限は別途（段階的に）扱う。
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options',        value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  {
    // 位置情報・マイクは未使用。カメラはキオスクのみ自オリジンに許可。
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    // preload は付けない（撤回が難しく、後からドメイン構成を変えられなくなる）。
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "frame-ancestors 'self'",  // クリックジャッキング（X-Frame-Options の後継）
      "base-uri 'self'",         // <base> 注入で相対 URL を攫われるのを防ぐ
      "form-action 'self'",      // フォームの送信先を外部に向けられるのを防ぐ
      "object-src 'none'",       // 旧プラグイン経由の実行を落とす
    ].join('; '),
  },
]

const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
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
