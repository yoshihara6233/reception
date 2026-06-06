'use client'

import { useEffect } from 'react'

/**
 * F32: SW 更新ループ修正版。
 *
 * 旧版は単純に register() しただけだったため、ブラウザの HTTP キャッシュが
 * /sw.js を保持していると新 SW ファイル自体に切り替わらず、旧 SW が
 * 古い _next/static バンドル（LiveKit 入り）を配信し続ける問題があった。
 *
 * 対策:
 *   1) updateViaCache: 'none' で /sw.js を毎回ネット取得
 *   2) 起動直後に reg.update() で更新チェック
 *   3) 新 SW が install→activate→controllerchange したら自動 1 回リロード
 *      （sessionStorage フラグで無限ループを防止）
 */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // F32.3: /sw.js (旧、シンタックスエラー入り) は browser に残っていると
    // 評価エラーで registration が失敗し続けるため、URL を変えて完全に別の
    // SW として登録する。/sw.js 側は kill-switch にしてあるので、既存登録は
    // 自動 unregister + cache 全消去 + reload される。
    navigator.serviceWorker
      .register('/sw-v2.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      .then(async (reg) => {
        console.info('[SW] registered', reg.scope)
        try { await reg.update() } catch { /* ignore */ }
      })
      .catch((err) => {
        console.warn('[SW] registration failed', err)
      })

    function onControllerChange() {
      const k = 'intereco-sw-reload-once'
      if (sessionStorage.getItem(k) === '1') return
      sessionStorage.setItem(k, '1')
      console.info('[SW] controllerchange — reloading')
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}
