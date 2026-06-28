'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import type { Lang } from '@/lib/i18n/messages'

/**
 * オフライン表示インジケータ。
 *
 * sw-v2.js が直近のページを Network-First でキャッシュするので、圏外でも最後に
 * 見たアラート/被害店舗データは表示できる。その際「今はキャッシュを見ている」と
 * 明示して、古い情報を最新と誤認しないようにする（既存オフライン機能の可視化）。
 */
const LABEL: Record<Lang, string> = {
  ja: 'オフライン — 直近のキャッシュを表示中',
  en: 'Offline — showing cached data',
  zh: '离线 — 显示缓存的数据',
  ko: '오프라인 — 캐시된 데이터 표시 중',
}

export function OfflineIndicator() {
  const { lang } = useLang()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-[11px] font-medium text-white shadow-sm"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6s2.5-3 11-3 11 3 11 3" />
        <path d="M5 10s1.5-2 7-2 7 2 7 2" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </svg>
      {LABEL[lang] ?? LABEL.ja}
    </div>
  )
}
