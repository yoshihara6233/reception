// Intereco Monitor — Service Worker (v2)
//
// Strategy:
//   - Static assets (JS/CSS/fonts/icons): Cache-First (stale-while-revalidate)
//   - Page navigations: Network-First (offline fallback to cached shell)
//   - API calls under /api/ : Network-Only (never cache live camera data)
//   - Grid images under /api/edges/<id>/grid : Network-Only
//
// IMPORTANT: keep all comments as line-comments (//) only.
// A previous version used a /* */ block comment containing the substring
// /api/edges/[asterisk]/grid, whose embedded asterisk-slash prematurely
// closed the block comment, causing the entire SW to fail to evaluate.

// CACHE_NAME を変えると activate ハンドラが古いキャッシュを全削除する。
// バンドル変更時はバンプすること。
const CACHE_NAME  = 'intereco-monitor-v2-f71'
const OFFLINE_URL = '/offline'

const STATIC_ASSETS = [
  '/',
  '/stores',
  '/map',
  '/offline',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {
        // 一部のパスが pre-cache 不可能でも install 自体は止めない
      }))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // /api/ → Network-Only (live cam data is never safe to cache)
  if (url.pathname.startsWith('/api/')) return

  // Next.js build assets → Cache-First (immutable hashed URLs)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Static files (icons, images) → Cache-First
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.match(/\.(png|jpg|svg|ico|woff2?)$/)
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Page navigations → Network-First with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request))
    return
  }
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    const offlinePage = await caches.match(OFFLINE_URL)
    return offlinePage ?? new Response('<h1>オフライン</h1>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Intereco Monitor', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Intereco Monitor', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: data.tag ?? 'monitor-alert',
      data: { url: data.url ?? '/stores' },
      requireInteraction: data.requireInteraction ?? false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/stores'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin))
      if (existing) {
        existing.focus()
        existing.navigate(target)
      } else {
        self.clients.openWindow(target)
      }
    })
  )
})
