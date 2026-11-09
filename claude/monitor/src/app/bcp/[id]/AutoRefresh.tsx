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
import { BCP_REFRESH_MS } from '@/lib/bcp/collecting'

/**
 * intervalMs は収集の段階で変える (lib/bcp/collecting.ts の bcpRefreshMs)。
 * 画像がそろって PDF を待つ間は短く、それ以外は 20 秒。
 */
export function AutoRefresh({ enabled, intervalMs = BCP_REFRESH_MS }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      router.refresh()
    }, intervalMs)
    return () => clearInterval(iv)
  }, [enabled, intervalMs, router])
  if (!enabled) return null
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-gedink3">
      <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
      収集中のため {intervalMs / 1000} 秒ごとに自動で読み直しています
    </p>
  )
}
