'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

export default function DonePage() {
  const [visitId, setVisitId] = useState<string>('')
  const [hasFace, setHasFace] = useState<boolean | null>(null)  // null = loading
  const { t, locale } = useLocale()
  const { announce } = useAnnounce()
  const params = useParams<{ token: string }>()

  useEffect(() => {
    const id = sessionStorage.getItem('reception-visit-id') || ''
    setVisitId(id)
    announce('done')

    // 顔登録済みかチェック (visitId → visitorId → face_id)
    if (id) {
      fetch(`/api/v1/visitors/face-status?visitId=${id}`)
        .then(r => r.json())
        .then(d => setHasFace(!!d.face_id))
        .catch(() => setHasFace(false))
    } else {
      setHasFace(false)
    }
  }, [announce])

  const shortId = visitId.slice(0, 8).toUpperCase()

  const L = (ja: string, en: string, zh: string, ko: string) => {
    if (locale === 'zh') return zh
    if (locale === 'ko') return ko
    if (locale === 'ja') return ja
    return en
  }

  const backLabel     = L('受付トップに戻る', 'Back to Reception', '返回受理台首页', '안내 데스크로 돌아가기')
  const faceRegLabel  = L('顔認証を登録する', 'Register Face Auth', '注册人脸识别', '얼굴 인증 등록하기')
  const faceRegDesc   = L(
    '次回から顔認証で素早く受付できます',
    'Check in faster next time with face auth',
    '下次可以用人脸识别快速签到',
    '다음부터 얼굴 인증으로 빠르게 접수하세요',
  )

  const faceRegUrl = `/r/${params.token}/face-register?visitId=${visitId}&lang=${locale}`

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

        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <div className="flex items-start gap-3">
            <span className="text-lg mt-0.5">&#x1F6B6;</span>
            <p className="text-sm text-gray-500 leading-relaxed">
              {t('checkin.passMessage')}
            </p>
          </div>
        </div>

        {/* 顔認証登録バナー: 未登録の場合のみ表示 */}
        {hasFace === false && visitId && (
          <a
            href={faceRegUrl}
            className="flex items-center gap-3 bg-white rounded-2xl p-5 shadow-sm mb-4 group hover:bg-[#f8f9ff] transition-colors"
          >
            <div className="w-10 h-10 bg-[#1e3a5f]/10 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-[#1e3a5f]/20 transition-colors">
              <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1e3a5f]">{faceRegLabel}</p>
              <p className="text-xs text-gray-400 mt-0.5">{faceRegDesc}</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        )}

        {/* Back to top button */}
        <a
          href={`/r/${params.token}`}
          className="block w-full py-4 bg-[#1e3a5f] text-white text-center text-sm font-semibold rounded-2xl shadow-sm"
        >
          {backLabel}
        </a>
      </div>

      {/* Footer */}
      <div className="py-5 text-center mt-6">
        <p className="text-[11px] text-gray-400 tracking-widest uppercase">
          Powered by Reception Kiosk
        </p>
      </div>
    </div>
  )
}
