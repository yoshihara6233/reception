'use client'

/**
 * SiteConfig — テナントのカスタム名称設定をアプリ全体へ伝播するための React Context。
 *
 * 使い方:
 *   server component (layout) → getSiteConfig() で取得 → <SiteConfigProvider config={...}>
 *   client component           → useSiteConfig() で参照
 */

import { createContext, useContext } from 'react'

export interface SiteConfig {
  /** 拠点の呼び方。デフォルト: "店舗"。設定で "倉庫" "拠点" "支店" 等に変更可能。 */
  locationName: string
}

export const defaultSiteConfig: SiteConfig = {
  locationName: '店舗',
}

export const SiteConfigContext = createContext<SiteConfig>(defaultSiteConfig)

/** admin 以下の client component で location name を取得するフック */
export function useSiteConfig(): SiteConfig {
  return useContext(SiteConfigContext)
}

/** admin/layout.tsx (server component) から使う Provider */
export function SiteConfigProvider({
  config,
  children,
}: {
  config: SiteConfig
  children: React.ReactNode
}) {
  return (
    <SiteConfigContext.Provider value={config}>
      {children}
    </SiteConfigContext.Provider>
  )
}
