'use client'

import { useEffect } from 'react'

/**
 * Service Worker 登録 + オンライン復帰時にキューをフラッシュ
 * RootLayout に配置
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('[SW] registration failed:', err)
    })

    // オンライン復帰時にキューをフラッシュ
    function handleOnline() {
      navigator.serviceWorker.ready.then(reg => {
        // Background Sync API があれば使う
        if ('sync' in reg) {
          (reg as any).sync.register('flush-queue').catch(() => {
            // フォールバック: メッセージで送信
            reg.active?.postMessage('FLUSH_QUEUE')
          })
        } else {
          reg.active?.postMessage('FLUSH_QUEUE')
        }
      })
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  return null
}
