// G・VMS-Cloud — Service Worker (v2)
//
// Strategy:
//   - Static assets (/_next/static/・/icons/・favicon): Cache-First
//   - Page navigations: Network-Only。圏外のときは /offline の画面だけを返す
//   - API calls under /api/ : Network-Only (never cache live camera data)
//
// 認証済みの画面 (HTML) は控えない (2026-10-29・自主診断 ASVS 14.3.1・14.3.3)。
// 以前は画面遷移の応答をすべて Cache Storage に入れ、install のときに '/' '/stores' '/map' も
// Cookie 付きで先に取り込んでいた。そのためログアウトしたあとも拠点の一覧や発報の HTML が
// 端末に残り、圏外で開くとそれが表示された (共用の端末で前の人の情報が見える)。
// いまは控えるのを「誰が見ても同じもの」(ビルドの静的ファイル・アイコン・/offline) だけにする。
// 判定は src/lib/pwa/client-cache.ts の isShareableCachePath と同じ (試験: client-cache.test.ts)。
//
// IMPORTANT: keep all comments as line-comments (//) only.
// A previous version used a /* */ block comment containing the substring
// /api/edges/[asterisk]/grid, whose embedded asterisk-slash prematurely
// closed the block comment, causing the entire SW to fail to evaluate.

// CACHE_NAME を変えると activate ハンドラが古いキャッシュを全削除する。
// バンドル変更時はバンプすること。
// f73: 認証済みの画面を控えていた f72 以前のキャッシュを、更新した端末から消すために上げた。
const CACHE_NAME  = 'intereco-monitor-v2-f73'
const OFFLINE_URL = '/offline'

// 先に取り込むのは /offline だけ (どの利用者にも同じ中身・middleware の ALLOW_PREFIXES で
// ロールによる転送もしない)。
const STATIC_ASSETS = [
  OFFLINE_URL,
]

// 控えてよい (利用者によって中身が変わらない) パスか。
// src/lib/pwa/client-cache.ts の isShareableCachePath と同じ判定にしておくこと。
function isShareablePath(pathname) {
  return pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/favicon.ico' ||
    pathname === OFFLINE_URL
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS)
        .then(() => precacheOfflineAssets(cache))
        .catch(() => {
          // 一部のパスが pre-cache 不可能でも install 自体は止めない
        }))
      .then(() => self.skipWaiting())
  )
})

// /offline の画面が読む /_next/static のファイルも先に取り込む。これが無いと、圏外で初めて
// /offline を出したときに画面の JS が動かず、接続が戻ったときの自動の再読み込みが
// meta refresh (15 秒) だけになる。
async function precacheOfflineAssets(cache) {
  const res = await cache.match(OFFLINE_URL)
  if (!res) return
  const html = await res.clone().text()
  const paths = Array.from(new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []))
  await Promise.all(paths.map((p) => cache.add(p).catch(() => {})))
}

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

  // ビルドの静的ファイル (ハッシュ付きの URL)・アイコン → Cache-First
  if (isShareablePath(url.pathname) && url.pathname !== OFFLINE_URL) {
    event.respondWith(cacheFirst(request))
    return
  }

  // 画面遷移 → Network-Only。応答は控えない。圏外のときは /offline の画面
  if (request.mode === 'navigate') {
    event.respondWith(networkOnlyWithOfflineFallback(request))
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

async function networkOnlyWithOfflineFallback(request) {
  try {
    return await fetch(request)
  } catch {
    // 前に見た画面は返さない (控えていない)。URL はそのままで /offline の中身を出すので、
    // 接続が戻ったときの再読み込みで元の画面へ戻る (キオスクもこれで自動で戻る)。
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
    data = { title: 'G・VMS-Cloud', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'G・VMS-Cloud', {
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
