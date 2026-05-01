'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

/**
 * 完了画面（チェックイン完了・退室完了）でカウントダウン後トップへ戻る
 *
 * @param delayMs  カウントダウン秒数（デフォルト 20_000 = 20秒）
 * @returns        残り秒数（UI 表示用）
 */
export function useAutoReturn(delayMs = 20_000): number {
  const router = useRouter()
  const params = useParams<{ token?: string }>()
  const [remaining, setRemaining] = useState(Math.ceil(delayMs / 1000))
  const startedAt = useRef(Date.now())
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const token = params?.token
    if (!token) return

    startedAt.current = Date.now()
    setRemaining(Math.ceil(delayMs / 1000))

    const tick = () => {
      const elapsed = Date.now() - startedAt.current
      const left = Math.max(0, Math.ceil((delayMs - elapsed) / 1000))
      setRemaining(left)

      if (elapsed >= delayMs) {
        router.replace(`/r/${token}`)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount once only

  return remaining
}
