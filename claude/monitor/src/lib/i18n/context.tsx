'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { MESSAGES, type Lang, type Msg } from './messages'

const STORAGE_KEY = 'intereco-lang'
const DEFAULT_LANG: Lang = 'ja'

interface LangContextValue {
  lang:    Lang
  t:       Msg
  setLang: (lang: Lang) => void
}

const LangContext = createContext<LangContextValue>({
  lang:    DEFAULT_LANG,
  t:       MESSAGES[DEFAULT_LANG],
  setLang: () => {},
})

/**
 * `initialLang` — server-side initial value, derived from the `intereco-lang`
 * cookie via getLang() in the root layout. Passing it from the server avoids
 * the JP→user-lang flicker on first paint and keeps client/server in sync.
 */
export function LangProvider({
  children,
  initialLang,
}: {
  children: ReactNode
  initialLang?: Lang
}) {
  const router = useRouter()
  const [lang, setLangState] = useState<Lang>(initialLang ?? DEFAULT_LANG)

  // Restore from localStorage on mount (only if no server-provided value).
  useEffect(() => {
    if (initialLang) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang | null
      if (stored && stored in MESSAGES) setLangState(stored)
    } catch {
      // localStorage unavailable (SSR guard)
    }
  }, [initialLang])

  function setLang(l: Lang) {
    if (l === lang) return
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
    // Write a cookie so server components on the next request can read
    // the user's choice and render in the right language.
    try {
      document.cookie = `${STORAGE_KEY}=${l}; path=/; max-age=31536000; samesite=lax`
    } catch { /* ignore */ }
    // CRITICAL: re-render server components with the new cookie, otherwise
    // AdminShell nav / breadcrumb / any t.xxx server-rendered text stays
    // in the previous language.
    try { router.refresh() } catch { /* ignore */ }
  }

  return (
    <LangContext.Provider value={{ lang, t: MESSAGES[lang], setLang }}>
      {children}
    </LangContext.Provider>
  )
}

/** Use inside any client component to get the current language and translations */
export function useLang() {
  return useContext(LangContext)
}
