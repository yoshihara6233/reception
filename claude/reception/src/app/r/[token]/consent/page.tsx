'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'
import type { Locale } from '@/lib/i18n/useLocale'

interface ConsentTemplate {
  id: string
  version: string
  body_ja: string
  body_en: string | null
  body_zh: string | null
  body_ko: string | null
}

function getBody(template: ConsentTemplate, locale: Locale): string {
  switch (locale) {
    case 'en': return template.body_en || template.body_ja
    case 'zh': return template.body_zh || template.body_ja
    case 'ko': return template.body_ko || template.body_ja
    default:   return template.body_ja
  }
}

export default function ConsentPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preToken = searchParams.get('pre')   // pre-registration token, forwarded through flow
  const { locale } = useLocale()
  const { announce } = useAnnounce()

  const [template, setTemplate] = useState<ConsentTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fetch active consent template for this area's tenant
    fetch(`/api/v1/visitors/consent?token=${params.token}`)
      .then(r => r.ok ? r.json() : { template: null })
      .then(data => {
        if (!data.template) {
          // No consent template configured → skip to next step
          navigateNext()
          return
        }
        setTemplate(data.template)
        setLoading(false)
      })
      .catch(() => {
        // On error, skip consent and proceed (non-blocking)
        navigateNext()
      })
  }, [params.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading && template) announce('register')
  }, [loading, template, announce])

  const navigateNext = () => {
    const settings = (() => {
      try {
        const raw = sessionStorage.getItem('reception-area-settings')
        return raw ? JSON.parse(raw) : null
      } catch { return null }
    })()

    const preParam = preToken ? `?pre=${preToken}` : ''

    if (!settings || settings.require_business_card !== 'hidden') {
      router.replace(`/r/${params.token}/card${preParam}`)
    } else {
      sessionStorage.removeItem('reception-card-photo')
      sessionStorage.removeItem('reception-ocr-result')
      router.replace(`/r/${params.token}/register${preParam}`)
    }
  }

  const handleAgree = async () => {
    if (!template || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/visitors/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: params.token,
          consent_template_id: template.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '同意の記録に失敗しました')
        setSubmitting(false)
        return
      }

      const { consent_record_id } = await res.json()
      // Save for linking to visit after check-in
      sessionStorage.setItem('reception-consent-record-id', consent_record_id)
      navigateNext()
    } catch {
      setError('ネットワークエラーが発生しました')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!template) return null

  const body = getBody(template, locale as Locale)

  const labels = {
    title: {
      ja: '個人情報の取り扱いについて',
      en: 'Privacy Policy',
      zh: '关于个人信息的处理',
      ko: '개인정보 처리에 관하여',
    },
    subtitle: {
      ja: `Ver. ${template.version} — 以下の内容をご確認の上、同意してください`,
      en: `Ver. ${template.version} — Please read and agree to the following`,
      zh: `Ver. ${template.version} — 请阅读以下内容并同意`,
      ko: `Ver. ${template.version} — 다음 내용을 확인하고 동의해 주세요`,
    },
    agree: {
      ja: '同意して続ける',
      en: 'I Agree & Continue',
      zh: '同意并继续',
      ko: '동의하고 계속',
    },
    decline: {
      ja: '戻る',
      en: 'Go Back',
      zh: '返回',
      ko: '돌아가기',
    },
  }

  const l = (locale as Locale) in labels.title ? (locale as Locale) : 'ja'

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-10 pb-8 text-white relative">
        <div className="flex items-center justify-center gap-1 mb-4">
          <span className="w-6 h-1 rounded-full bg-white" />
          <span className="w-6 h-1 rounded-full bg-white/30" />
          <span className="w-6 h-1 rounded-full bg-white/30" />
        </div>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-3 flex items-center gap-1">
          &larr; 戻る
        </button>
        <h1 className="text-xl font-semibold">{labels.title[l]}</h1>
        <p className="text-xs text-white/60 mt-1">{labels.subtitle[l]}</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8">
        {/* Consent body */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 max-h-72 overflow-y-auto">
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {body}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {/* Agree button */}
        <button
          onClick={handleAgree}
          disabled={submitting}
          className="w-full py-4 bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-3"
        >
          {submitting
            ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <>{labels.agree[l]} <span className="opacity-60">&rarr;</span></>
          }
        </button>

        <button
          onClick={() => router.back()}
          className="w-full py-3 text-gray-500 text-sm font-medium"
        >
          {labels.decline[l]}
        </button>

        <p className="text-center text-xs text-gray-400 mt-4">
          🔒{' '}
          {l === 'ja' ? 'データは暗号化して安全に管理されます' : 'Your data is encrypted and secure'}
        </p>
      </div>
    </div>
  )
}
