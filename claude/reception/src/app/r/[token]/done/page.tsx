'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

export default function DonePage() {
  const [visitId, setVisitId] = useState<string>('')
  const { t } = useLocale()
  const { announce } = useAnnounce()

  useEffect(() => {
    const id = sessionStorage.getItem('reception-visit-id') || ''
    setVisitId(id)
    announce('done')
  }, [announce])

  const shortId = visitId.slice(0, 8).toUpperCase()

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-16 pb-12 text-white text-center relative">
        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">{t('checkin.success')}</h1>
        <p className="text-sm text-white/60 mt-1">Check-in Complete</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 flex-1">
        {/* Pass card */}
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center mb-4">
          <p className="text-xs text-gray-400 tracking-widest uppercase mb-2">
            {t('checkin.passNumber')}
          </p>
          <p className="text-4xl font-mono font-bold text-[#1e3a5f] tracking-wider">
            {shortId || '--------'}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-lg mt-0.5">&#x1F6B6;</span>
            <p className="text-sm text-gray-500 leading-relaxed">
              {t('checkin.passMessage')}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[#1e3a5f] py-5 text-center mt-auto">
        <p className="text-[11px] text-white/50 tracking-widest uppercase">
          Powered by Reception Kiosk
        </p>
      </div>
    </div>
  )
}
