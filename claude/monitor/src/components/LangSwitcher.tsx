'use client'

/**
 * Language switcher — shows flag + label for current lang,
 * opens a dropdown with all 4 options.
 * Works in both the dark AppHeader and any light context.
 */

import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import { LANGS, LANG_META } from '@/lib/i18n/messages'

export function LangSwitcher() {
  const { lang, setLang } = useLang()
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = LANG_META[lang]

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
        aria-label="言語を切り替える / Switch language"
      >
        <span className="text-sm leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.short}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-[200] mt-1.5 min-w-[132px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          {LANGS.map((l) => {
            const meta    = LANG_META[l]
            const active  = l === lang
            return (
              <button
                key={l}
                onClick={() => { setLang(l); setOpen(false) }}
                className={[
                  'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors',
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800',
                ].join(' ')}
              >
                <span className="text-base leading-none">{meta.flag}</span>
                <span className="font-medium">{meta.label}</span>
                {active && (
                  <svg
                    className="ml-auto" width="12" height="12"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
