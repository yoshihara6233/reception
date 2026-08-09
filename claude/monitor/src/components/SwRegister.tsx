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
 *
 * ただしリロードするのは**更新のときだけ**。初回インストールでは捨てるべき
 * 古いバンドルが存在しないので、リロードには利点が無く、害だけがある:
 * SW の activate は利用者の操作と非同期に起こるため、**入力や遷移の途中で
 * ページを巻き戻す**。ログイン直後に当たると、認証は成功しているのに空の
 * ログイン画面へ戻される（2026-08-09、E2E 導入時に毎回再現した）。
 */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // 登録前の状態を控える。null＝この訪問が初回インストール。
    const hadController = !!navigator.serviceWorker.controller

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
      // 初回インストール（前任の SW がいない）ならリロードしない。
      // 差し替える古いキャッシュが無いので、リロードは操作を壊すだけ。
      if (!hadController) {
        console.info('[SW] first install — reload skipped')
        return
      }
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
