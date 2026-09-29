'use client'

/**
 * 遠隔視聴の自動の再接続（決まりは lib/video/auto-reconnect.ts）。
 *
 * 呼び出し側は「いまの失敗」「映像が出ているか」と、視聴を開き直す関数（attempt を進める）を渡す。
 * 開き直すたびに useRemoteVideoSession の後始末が前のセッションを DELETE で止めるので、
 * やり直しで視聴セッションは増えない。画面を離れたら（アンマウント）時計を止める。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  ReconnectController, isReconnecting, reconnectStatusText, type ReconnectState,
} from '@/lib/video/auto-reconnect'

interface Options {
  /** 開き直した回数（同じ失敗が続いても、開き直すたびに新しい失敗として数える） */
  attempt: number
  /** いまの失敗（無ければ null）。やり直すかどうかは値で決まる */
  errorCode: string | null
  /** 映像が出ている（最初のフレームが出た後で、失敗していない） */
  playing: boolean
  /** 視聴を開き直す */
  retry: () => void
}

export interface AutoReconnectView {
  state: ReconnectState
  /** 自動でつなぎ直している最中（失敗の文の代わりに statusText を出す） */
  reconnecting: boolean
  /** 画面に出す状態の文（つなぎ直していなければ null） */
  statusText: string | null
  /** 手で再試行する（回数を数え直してから開き直す） */
  manualRetry: () => void
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function useAutoReconnect({ attempt, errorCode, playing, retry }: Options): AutoReconnectView {
  const [ctl] = useState(() => new ReconnectController({
    now: () => Date.now(),
    online: isOnline,
    visible: isVisible,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }))
  // 開き直す関数は描画ごとに変わりうるので、最新を渡しておく
  useEffect(() => { ctl.setRetry(retry) }, [ctl, retry])
  const state = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)

  useEffect(() => {
    ctl.attach()
    const onOnline = () => ctl.online()
    const onVisibility = () => ctl.visible()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      ctl.detach()
    }
  }, [ctl])

  useEffect(() => {
    if (errorCode) ctl.failed(errorCode)
  }, [ctl, attempt, errorCode])

  useEffect(() => {
    ctl.setPlaying(playing && !errorCode)
  }, [ctl, attempt, playing, errorCode])

  const manualRetry = useCallback(() => {
    ctl.manual()
    retry()
  }, [ctl, retry])

  return { state, reconnecting: isReconnecting(state), statusText: reconnectStatusText(state), manualRetry }
}
