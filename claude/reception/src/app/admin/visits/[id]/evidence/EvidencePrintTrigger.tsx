'use client'

import { useEffect } from 'react'

/**
 * 印刷ダイアログを自動で開く client component。
 * page.tsx (Server Component) からマウントされる。
 * URLに ?auto=1 がある時だけ自動印刷する。
 */
export default function EvidencePrintTrigger() {
  useEffect(() => {
    const auto = new URLSearchParams(window.location.search).get('auto')
    if (auto === '1') {
      // 画像の読み込みを少し待ってから印刷
      const timer = setTimeout(() => window.print(), 1200)
      return () => clearTimeout(timer)
    }
  }, [])

  return null
}
