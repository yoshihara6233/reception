'use client'

import { useSyncExternalStore, useCallback } from 'react'
import ja from './messages/ja.json'
import en from './messages/en.json'
import zh from './messages/zh.json'
import ko from './messages/ko.json'

export type Locale = 'ja' | 'en' | 'zh' | 'ko'
type Messages = typeof ja

const STORAGE_KEY = 'reception-locale'
const VALID_LOCALES: Locale[] = ['ja', 'en', 'zh', 'ko']
const messages: Record<Locale, Messages> = { ja, en, zh: zh as Messages, ko: ko as Messages }

// ── useSyncExternalStore helpers ──────────────────────────────────────────────

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

function getSnapshot(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
  return saved && VALID_LOCALES.includes(saved) ? saved : 'ja'
}

// Server render always returns 'ja' (no localStorage on server)
function getServerSnapshot(): Locale {
  return 'ja'
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLocale() {
  // useSyncExternalStore: reads localStorage synchronously on client,
  // avoids the 'ja' → 'en' flash that the old useState+useEffect approach caused.
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next)
    // Dispatch StorageEvent so all mounted components update immediately
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: next }))
  }, [])

  const t = useCallback(
    (path: string, vars?: Record<string, string>): string => {
      const keys = path.split('.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let val: any = messages[locale]
      for (const key of keys) {
        val = val?.[key]
        if (val === undefined) return path
      }
      if (typeof val !== 'string') return path
      if (vars) return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
      return val
    },
    [locale]
  )

  return { locale, setLocale, t }
}
