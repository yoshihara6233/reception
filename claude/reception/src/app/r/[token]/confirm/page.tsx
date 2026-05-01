'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

interface FormData {
  company: string
  department: string
  name: string
  phone: string
  email: string
  purpose: string
  purposeDetail: string
  contactPerson: string
  contactPersonId: string | null
  token: string
}

export default function ConfirmPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { t } = useLocale()
  const { announce } = useAnnounce()
  const [form, setForm] = useState<FormData | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { announce('confirm') }, [announce])

  useEffect(() => {
    const data = sessionStorage.getItem('reception-form')
    if (!data) {
      router.replace(`/r/${params.token}/register`)
      return
    }
    setForm(JSON.parse(data))
  }, [params.token, router])

  const uploadPhoto = async (visitId: string, tenantId: string, type: 'card' | 'face', dataUrl: string) => {
    try {
      await fetch('/api/v1/visits/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, tenantId, type, dataUrl }),
      })
    } catch {
      // Photo upload failure is non-fatal — visit is already recorded
      console.warn(`Failed to upload ${type} photo`)
    }
  }

  const uploadBaggagePhoto = async (visitId: string, tenantId: string, slot: 'contents' | 'empty', dataUrl: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/v1/visits/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, tenantId, type: `baggage_${slot}`, photoData: dataUrl }),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.storagePath || null
    } catch { return null }
  }

  const handleCheckIn = async () => {
    if (!form || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/visits/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: params.token,
          company: form.company,
          department: form.department,
          name: form.name,
          phone: form.phone,
          email: form.email,
          purpose: form.purpose === 'その他'
            ? (form.purposeDetail || 'その他')
            : form.purpose,
          contactPerson: form.contactPerson,
          contactPersonId: form.contactPersonId || null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'チェックインに失敗しました')
      }

      const { visitId, tenantId } = await res.json()

      // Upload photos captured in sessionStorage (non-blocking, parallel)
      const cardPhoto = sessionStorage.getItem('reception-card-photo')
      const facePhoto = sessionStorage.getItem('reception-face-photo')
      const uploadTasks: Promise<void>[] = []
      if (cardPhoto) uploadTasks.push(uploadPhoto(visitId, tenantId, 'card', cardPhoto))
      if (facePhoto) uploadTasks.push(uploadPhoto(visitId, tenantId, 'face', facePhoto))
      if (uploadTasks.length > 0) await Promise.all(uploadTasks)

      // Submit baggage declaration (checkin) if present
      const baggageMode = sessionStorage.getItem('reception-baggage-checkin-mode')
      const baggageDecl = sessionStorage.getItem('reception-baggage-checkin-declaration')
      const baggageContents = sessionStorage.getItem('reception-baggage-checkin-photo-contents')
      const baggageEmpty = sessionStorage.getItem('reception-baggage-checkin-photo-empty')

      if (baggageMode) {
        let photoPathContents: string | null = null
        let photoPathEmpty: string | null = null
        if (baggageMode === 'photo') {
          if (baggageContents) photoPathContents = await uploadBaggagePhoto(visitId, tenantId, 'contents', baggageContents)
          if (baggageEmpty) photoPathEmpty = await uploadBaggagePhoto(visitId, tenantId, 'empty', baggageEmpty)
        }

        await fetch('/api/v1/visits/baggage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitId, tenantId, context: 'checkin',
            declaration: baggageDecl || null,
            photoPathContents, photoPathEmpty,
            inspectionMode: baggageMode,
          }),
        }).catch(() => {/* non-fatal */})

        sessionStorage.removeItem('reception-baggage-checkin-mode')
        sessionStorage.removeItem('reception-baggage-checkin-declaration')
        sessionStorage.removeItem('reception-baggage-checkin-photo-contents')
        sessionStorage.removeItem('reception-baggage-checkin-photo-empty')
      }

      // Link consent record to visit (fire-and-forget)
      const consentRecordId = sessionStorage.getItem('reception-consent-record-id')
      if (consentRecordId) {
        fetch('/api/v1/visitors/consent/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent_record_id: consentRecordId, visit_id: visitId }),
        }).catch(() => {/* non-fatal */})
      }

      // Mark pre-registration as used (fire-and-forget)
      const preRegId = sessionStorage.getItem('reception-pre-reg-id')
      if (preRegId) {
        fetch('/api/v1/pre-registrations/mark-used', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pre_registration_id: preRegId, visit_id: visitId }),
        }).catch(() => {/* non-fatal */})
      }

      // Clean up sessionStorage
      sessionStorage.removeItem('reception-form')
      sessionStorage.removeItem('reception-card-photo')
      sessionStorage.removeItem('reception-face-photo')
      sessionStorage.removeItem('reception-consent-record-id')
      sessionStorage.removeItem('reception-pre-reg-id')
      sessionStorage.setItem('reception-visit-id', visitId)
      localStorage.setItem('reception-visitor-token', params.token)

      router.push(`/r/${params.token}/done`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
      setSubmitting(false)
    }
  }

  if (!form) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-12 pb-8 text-white relative">
        <button
          onClick={() => router.back()}
          className="text-white/60 text-sm mb-4 flex items-center gap-1"
        >
          &larr; {t('common.back')}
        </button>
        <h1 className="text-xl font-semibold">{t('checkin.title')}</h1>
        <p className="text-sm text-white/60 mt-1">Confirmation</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8">
        {/* Confirm card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-4">
          <div className="space-y-3">
            <ConfirmRow label={t('register.company')} value={form.company} />
            <ConfirmRow label={t('register.name')} value={form.name} />
            {form.department && <ConfirmRow label={t('register.department')} value={form.department} />}
            {form.phone && <ConfirmRow label={t('register.phone')} value={form.phone} />}
            <ConfirmRow
              label={t('register.purpose')}
              value={form.purpose === 'その他'
                ? (form.purposeDetail || 'その他')
                : form.purpose}
            />
            {form.contactPerson && <ConfirmRow label={t('register.contactPerson')} value={form.contactPerson} />}
          </div>
        </div>

        {/* Consent */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg">&#x1F512;</span>
            <p className="text-sm font-medium text-[#1e3a5f]">{t('consent.title')}</p>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            {t('consent.description')}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 rounded-2xl p-4 mb-4 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleCheckIn}
          disabled={submitting}
          className="w-full py-4 bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <span className="text-lg">&#x1F6AA;</span>
          {submitting ? t('common.loading') : t('consent.agree')}
        </button>
      </div>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-[#1e3a5f]">{value}</span>
    </div>
  )
}
