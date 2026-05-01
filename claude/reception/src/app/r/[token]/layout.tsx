'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'
import type { Locale } from '@/lib/i18n/useLocale'
import { SpeechToggle } from '@/lib/speech/SpeechToggle'

const LANG_OPTIONS: { locale: Locale; flag: string; label: string; native: string }[] = [
  { locale: 'ja', flag: '🇯🇵', label: 'JP', native: '日本語' },
  { locale: 'en', flag: '🇺🇸', label: 'EN', native: 'English' },
  { locale: 'zh', flag: '🇨🇳', label: 'ZH', native: '中文' },
  { locale: 'ko', flag: '🇰🇷', label: 'KO', native: '한국어' },
]

export default function VisitorLayout({ children }: { children: React.ReactNode }) {
  // Use the shared useLocale hook — now backed by useSyncExternalStore,
  // so locale is always in sync with localStorage with no flash.
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const select = useCallback((next: Locale) => {
    setLocale(next)
    setOpen(false)
  }, [setLocale])

  const current = LANG_OPTIONS.find(o => o.locale === locale) ?? LANG_OPTIONS[0]

  return (
    <>
      {children}

      {/* Speech toggle — fixed top-right */}
      {mounted && <SpeechToggle />}

      {/* Language picker — fixed floating button + dropdown */}
      {mounted && (
        <div ref={ref} className="fixed bottom-6 right-5 z-50">
          {/* Dropdown list (opens upward) */}
          {open && (
            <div className="absolute bottom-full mb-2 right-0 bg-white border border-gray-200 shadow-lg rounded-2xl overflow-hidden min-w-[140px]">
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.locale}
                  onClick={() => select(opt.locale)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm hover:bg-[#f0f2f5] transition-colors ${
                    opt.locale === locale
                      ? 'bg-[#f0f2f5] text-[#1e3a5f] font-semibold'
                      : 'text-gray-600'
                  }`}
                >
                  <span className="text-lg leading-none">{opt.flag}</span>
                  <span>{opt.native}</span>
                </button>
              ))}
            </div>
          )}

          {/* Trigger button */}
          <button
            onClick={() => setOpen(v => !v)}
            aria-label="Switch language"
            className="flex items-center gap-1.5 bg-white/95 backdrop-blur border border-gray-200 shadow-md rounded-full px-3 py-2 text-xs font-medium text-gray-600 hover:bg-white transition-colors"
          >
            <span className="text-base leading-none">{current.flag}</span>
            <span className="font-semibold text-[#1e3a5f]">{current.label}</span>
            <span className="text-gray-400 text-[10px]">{open ? '▲' : '▼'}</span>
          </button>
        </div>
      )}
    </>
  )
}
