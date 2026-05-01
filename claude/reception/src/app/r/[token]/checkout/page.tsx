'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

export default function CheckoutPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useLocale()
  const { announce } = useAnnounce()
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baggageRequired, setBaggageRequired] = useState(false)
  const [baggage, setBaggage] = useState<{ done: boolean; mode: string | null }>({ done: false, mode: null })

  const preToken = searchParams.get('pre')

  useEffect(() => { announce('checkout') }, [announce])

  // エリア設定を読み込み、手荷物検査の要否チェック
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (raw) {
        const s = JSON.parse(raw)
        const val = s.require_baggage_inspection_checkout ?? 'none'
        if (val !== 'none') {
          setBaggageRequired(true)
        }
      }
    } catch { /* ignore */ }

    // 手荷物検査済みか確認
    const done = sessionStorage.getItem('reception-baggage-checkout-done') === '1'
    const mode = sessionStorage.getItem('reception-baggage-checkout-mode')
    setBaggage({ done, mode })
  }, [])

  // 手荷物検査が必要で未完了なら baggage ページへリダイレクト
  useEffect(() => {
    if (baggageRequired && !baggage.done) {
      router.replace(`/r/${params.token}/baggage?context=checkout`)
    }
  }, [baggageRequired, baggage.done, params.token, router])

  // 退室後に手荷物申告を送信する
  const submitBaggageDeclaration = async (visitId: string, tenantId: string) => {
    const mode = sessionStorage.getItem('reception-baggage-checkout-mode')
    const decl = sessionStorage.getItem('reception-baggage-checkout-declaration')
    const contentsDataUrl = sessionStorage.getItem('reception-baggage-checkout-photo-contents')
    const emptyDataUrl = sessionStorage.getItem('reception-baggage-checkout-photo-empty')

    if (!mode) return

    let photoPathContents: string | null = null
    let photoPathEmpty: string | null = null

    if (mode === 'photo') {
      if (contentsDataUrl) {
        try {
          const res = await fetch('/api/v1/visits/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitId, tenantId, type: 'baggage_contents', dataUrl: contentsDataUrl }),
          })
          if (res.ok) {
            const data = await res.json()
            photoPathContents = data.storagePath || null
          }
        } catch { /* non-fatal */ }
      }
      if (emptyDataUrl) {
        try {
          const res = await fetch('/api/v1/visits/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitId, tenantId, type: 'baggage_empty', dataUrl: emptyDataUrl }),
          })
          if (res.ok) {
            const data = await res.json()
            photoPathEmpty = data.storagePath || null
          }
        } catch { /* non-fatal */ }
      }
    }

    await fetch('/api/v1/visits/baggage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitId, tenantId, context: 'checkout',
        declaration: decl || null,
        photoPathContents,
        photoPathEmpty,
        inspectionMode: mode,
      }),
    }).catch(() => { /* non-fatal */ })

    // sessionStorage クリア
    ;[
      'reception-baggage-checkout-done',
      'reception-baggage-checkout-mode',
      'reception-baggage-checkout-declaration',
      'reception-baggage-checkout-photo-contents',
      'reception-baggage-checkout-photo-empty',
    ].forEach(k => sessionStorage.removeItem(k))
  }

  const handleCheckout = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const deviceToken = localStorage.getItem('reception-visitor-token')

      const res = await fetch('/api/v1/visits/check-out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(deviceToken ? { 'x-device-token': deviceToken } : {}),
        },
        body: JSON.stringify({
          token: params.token,
          ...(preToken ? { preToken } : {}),
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || '退室処理に失敗しました')
      }

      const { visitId, tenantId } = await res.json()

      // 手荷物申告を送信（non-blocking）
      if (visitId && tenantId) {
        await submitBaggageDeclaration(visitId, tenantId)
      }

      setSuccess(true)
      announce('checkout-done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
        <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-16 pb-12 text-white text-center relative">
          <div className="w-16 h-16 bg-blue-400/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">{t('checkout.success')}</h1>
          <p className="text-sm text-white/60 mt-1">Check-out Complete</p>
          <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
        </div>
        <div className="px-5 -mt-1 flex-1">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-gray-500">{t('checkout.success')}</p>
          </div>
        </div>
        <div className="bg-[#1e3a5f] py-5 text-center mt-auto">
          <p className="text-[11px] text-white/50 tracking-widest uppercase">
            Powered by Reception Kiosk
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-12 pb-8 text-white relative">
        <button
          onClick={() => router.replace(`/r/${params.token}/checkoutchoice`)}
          className="text-white/60 text-sm mb-4 flex items-center gap-1"
        >
          &larr; {t('common.back')}
        </button>
        <h1 className="text-xl font-semibold">{t('checkout.title')}</h1>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 flex-1 space-y-4">
        {/* 手荷物検査済みバナー */}
        {baggage.done && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-sm font-medium text-emerald-700">退室時 手荷物検査完了</p>
              <p className="text-xs text-emerald-600 mt-0.5">退室後にレポートに記録されます</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 rounded-2xl p-4 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleCheckout}
          disabled={submitting}
          className="w-full py-4 bg-white text-[#1e3a5f] border-2 border-[#1e3a5f] rounded-[14px] text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <span className="text-lg">&#x1F6B6;</span>
          {submitting ? t('common.loading') : t('checkout.confirmButton')}
        </button>
      </div>

      <div className="bg-[#1e3a5f] py-5 text-center mt-auto">
        <p className="text-[11px] text-white/50 tracking-widest uppercase">
          Powered by Reception Kiosk
        </p>
      </div>
    </div>
  )
}
