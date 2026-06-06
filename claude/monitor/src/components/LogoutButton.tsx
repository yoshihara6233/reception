'use client'

/**
 * F24: Logout icon button — sits at the right end of the header.
 *
 * Calls supabase.auth.signOut() in the browser to clear local session
 * (also clears cookies via @supabase/ssr), then hard-reloads to /login
 * so server components re-evaluate auth state cleanly.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { useLang } from '@/lib/i18n/context'

export function LogoutButton() {
  const router = useRouter()
  const { t }  = useLang()
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      const supa = createSupabaseBrowser()
      await supa.auth.signOut()
    } catch {
      // best-effort — even if signOut fails, push to /login
    }
    // Use hard navigation so server components re-read the (now empty) cookie.
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
      aria-label={t.nav.logout}
      title={t.nav.logout}
    >
      {/* Power / log-out icon */}
      <svg
        width="18" height="18" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  )
}
