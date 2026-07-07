'use client'

/**
 * R1: 視聴セッション時間上限（デフォルト120分・テナント毎）のクライアント側カウントダウン。
 *
 * サーバ(/api/sessions start)が返す max_session_min と、視聴開始時刻から残秒を毎秒算出し、
 * 0 到達で expired=true を返す。呼び出し側はこの expired を見てストリームを停止し、
 * セッションを終了記録する。maxSessionMin が null（未取得 or 上限対象外の grid）の間は無効。
 */
import { useEffect, useState } from 'react'

/** 残秒を mm:ss で表記（負値は 0:00）。 */
export function formatRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function useSessionCountdown(
  startedAtMs: number | null,
  maxSessionMin: number | null,
): { remainingSec: number | null; expired: boolean } {
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (startedAtMs == null || maxSessionMin == null || maxSessionMin <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemainingSec(null)
      setExpired(false)
      return
    }
    const capMs = maxSessionMin * 60_000
    const compute = () => {
      const rem = Math.ceil((startedAtMs + capMs - Date.now()) / 1000)
      setRemainingSec(Math.max(0, rem))
      if (rem <= 0) setExpired(true)
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [startedAtMs, maxSessionMin])

  return { remainingSec, expired }
}
