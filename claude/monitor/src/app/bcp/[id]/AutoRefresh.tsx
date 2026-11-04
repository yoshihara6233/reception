'use client'

/**
 * 収集中の BCP 詳細を一定の間隔で読み直す (2026-11-04・シナリオ試験の所見)。
 *
 * 以前は詳細を開いたままだと、拠点の画像の収集が進んで PDF が自動でできても、読み直すまで
 * 「レポートはまだ生成されていません」のままだった。サーバ側で「収集中か」を決めて
 * enabled で渡し、その間だけ router.refresh() する (サーバコンポーネントの再取得)。
 * 画面が裏にある間は読み直さない。
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

export const BCP_REFRESH_MS = 20_000

export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      router.refresh()
    }, BCP_REFRESH_MS)
    return () => clearInterval(iv)
  }, [enabled, router])
  if (!enabled) return null
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-gedink3">
      <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
      収集中のため {BCP_REFRESH_MS / 1000} 秒ごとに自動で読み直しています
    </p>
  )
}
