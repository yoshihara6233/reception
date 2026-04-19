'use client'

import { useState, useEffect, useCallback } from 'react'
import ja from './messages/ja.json'
import en from './messages/en.json'
import zh from './messages/zh.json'
import ko from './messages/ko.json'

export type Locale = 'ja' | 'en' | 'zh' | 'ko'
type Messages = typeof ja

const STORAGE_KEY = 'reception-locale'
const VALID_LOCALES: Locale[] = ['ja', 'en', 'zh', 'ko']
const messages: Record<Locale, Messages> = { ja, en, zh: zh as Messages, ko: ko as Messages }

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>('ja')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
    if (saved && VALID_LOCALES.includes(saved)) setLocaleState(saved)

    // Sync when layout toggles the locale (StorageEvent from same tab)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && VALID_LOCALES.includes(e.newValue as Locale)) {
        setLocaleState(e.newValue as Locale)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next)
    setLocaleState(next)
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
