import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Intereco Monitor',
    short_name: 'Monitor',
    description: 'レコーダ統合監視システム — 本部一元監視プラットフォーム',
    start_url: '/stores',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0F0F10',
    theme_color: '#0F0F10',
    categories: ['business', 'security'],
    icons: [
      { src: '/icons/icon-72.png',  sizes: '72x72',   type: 'image/png' },
      { src: '/icons/icon-96.png',  sizes: '96x96',   type: 'image/png' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: '地図で店舗確認',
        short_name: '地図',
        url: '/map',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
      {
        name: '監視一覧',
        short_name: '監視',
        url: '/stores',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
    ],
  }
}
