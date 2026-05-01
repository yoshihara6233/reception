'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface KioskModeOptions {
  /** ミリ秒。デフォルト 60_000 (1分) */
  idleTimeoutMs?: number
  /** スクリーン常時点灯。デフォルト true */
  enableWakeLock?: boolean
  /** 無操作リセット。デフォルト true */
  enableIdleReset?: boolean
}

/**
 * PWA キオスクモード共通フック
 *
 * - Wake Lock API でスクリーン消灯を防ぐ（iOS Safari 16.4+ / Chrome 84+）
 * - タッチ・クリック無操作が idleTimeoutMs 続いたら /r/{token} へリダイレクト
 * - visibility change で Wake Lock を再取得（iOS が hidden 時に解放するため）
 */
export function useKioskMode({
  idleTimeoutMs = 60_000,
  enableWakeLock = true,
  enableIdleReset = true,
}: KioskModeOptions = {}) {
  const router = useRouter()
  const params = useParams<{ token?: string }>()
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Wake Lock ──────────────────────────────────────────────────────────────

  const acquireWakeLock = useCallback(async () => {
    if (!enableWakeLock) return
    if (!('wakeLock' in navigator)) return
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) return
      wakeLockRef.current = await (navigator as Navigator & {
        wakeLock: { request: (type: string) => Promise<WakeLockSentinel> }
      }).wakeLock.request('screen')
    } catch {
      // 低バッテリーモード等では取得できない — 無視
    }
  }, [enableWakeLock])

  useEffect(() => {
    if (!enableWakeLock) return
    acquireWakeLock()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      wakeLockRef.current?.release().catch(() => {})
    }
  }, [enableWakeLock, acquireWakeLock])

  // ── Idle Reset ──────────────────────────────────────────────────────────────

  const resetTimer = useCallback(() => {
    if (!enableIdleReset) return
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      const token = params?.token
      if (token) router.replace(`/r/${token}`)
    }, idleTimeoutMs)
  }, [enableIdleReset, idleTimeoutMs, params?.token, router])

  useEffect(() => {
    if (!enableIdleReset) return

    const EVENTS = ['touchstart', 'touchend', 'mousedown', 'mousemove', 'keydown', 'scroll'] as const
    EVENTS.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      EVENTS.forEach(ev => window.removeEventListener(ev, resetTimer))
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [enableIdleReset, resetTimer])
}
