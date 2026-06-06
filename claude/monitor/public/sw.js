// Intereco Monitor — kill-switch SW (v0 legacy)
//
// The previous version of this file had a syntactically broken header
// (a block comment that was prematurely closed by an embedded asterisk-
// slash), causing ServiceWorker registration to fail. Browsers that
// already registered the broken script will keep trying to load it from
// HTTP cache for up to 24 h.
//
// This stub file's sole job: cleanly unregister itself and clear all
// caches, then never run again. The active SW now lives at /sw-v2.js.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // 1) Nuke every cache this SW owned
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch { /* ignore */ }
      try {
        // 2) Unregister this very SW so the browser stops loading /sw.js
        await self.registration.unregister()
      } catch { /* ignore */ }
      try {
        // 3) Force a reload of every controlled client so they pick up
        //    /sw-v2.js via the new SwRegister code path.
        const clients = await self.clients.matchAll({ type: 'window' })
        for (const c of clients) c.navigate(c.url)
      } catch { /* ignore */ }
    })()
  )
})

// Don't intercept any fetches — let the network handle everything.
