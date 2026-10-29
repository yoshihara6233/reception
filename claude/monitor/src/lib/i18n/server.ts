/**
 * Server-side language helpers — mirror of the client `useLang()` hook for
 * Server Components.
 *
 * The client `LangProvider` writes the chosen language to both localStorage
 * (for fast client restore) AND a cookie named `intereco-lang`. This module
 * reads that cookie via Next.js' `cookies()` API and returns the matching
 * message bundle.
 *
 * Usage in a Server Component:
 *   const t = await getT()
 *   <h1>{t.workspace.split16}</h1>
 */
import { cookies } from 'next/headers'
import { MESSAGES, type Lang, type Msg } from './messages'
import { readHostCookie } from '@/lib/security/cookie-names'

const COOKIE_NAME: string = 'intereco-lang'
const DEFAULT_LANG: Lang = 'ja'

export async function getLang(): Promise<Lang> {
  const store = await cookies()
  const c = readHostCookie(store, COOKIE_NAME)
  if (c && (c === 'ja' || c === 'en' || c === 'zh' || c === 'ko')) return c
  return DEFAULT_LANG
}

export async function getT(): Promise<Msg> {
  return MESSAGES[await getLang()]
}
