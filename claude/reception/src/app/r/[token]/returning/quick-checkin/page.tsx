'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'

interface ReturningData {
  visitorId:         string
  name:              string
  company:           string
  department:        string
  phone:             string
  email:             string
  lastPurpose:       string
  lastContactPerson: string
}

interface StaffMember {
  id:   string
  name: string
}

const DEFAULT_PURPOSES = ['定期配送', 'メンテナンス', '商談', '監査', 'その他']

export default function QuickCheckinPage() {
  const params  = useParams<{ token: string }>()
  const router  = useRouter()
  const { locale } = useLocale()

  const [returning, setReturning] = useState<ReturningData | null>(null)
  const [purpose, setPurpose]     = useState('')
  const [purposeDetail, setPurposeDetail] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [staff, setStaff]         = useState<StaffMember[]>([])
  const [purposes, setPurposes]   = useState(DEFAULT_PURPOSES)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem('reception-returning-visitor')
    if (!raw) {
      router.replace(`/r/${params.token}`)
      return
    }
    const data: ReturningData = JSON.parse(raw)
    setReturning(data)
    // 前回の目的と担当者をデフォルト設定
    setPurpose(data.lastPurpose || '')
    setContactPerson(data.lastContactPerson || '')

    // エリア設定を取得してカスタム目的リストを確認
    const areaSettings = (() => {
      try { return JSON.parse(sessionStorage.getItem('reception-area-settings') || '{}') } catch { return {} }
    })()
    if (Array.isArray(areaSettings.visit_purposes) && areaSettings.visit_purposes.length > 0) {
      setPurposes(areaSettings.visit_purposes)
    }
  }, [params.token, router])

  // スタッフリスト取得
  useEffect(() => {
    fetch(`/api/v1/areas/${params.token}/staff`)
      .then(r => r.ok ? r.json() : { staff: [] })
      .then(d => setStaff(d.staff ?? []))
      .catch(() => {})
  }, [params.token])

  const handleSubmit = async () => {
    if (!returning || submitting) return
    if (!purpose) { setError('来訪目的を選択してください'); return }
    if (!contactPerson.trim()) { setError('担当者名を入力してください'); return }

    setSubmitting(true)
    setError(null)

    const finalPurpose = purpose === 'その他' ? purposeDetail : purpose

    try {
      const res = await fetch('/api/v1/visits/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token:         params.token,
          company:       returning.company,
          department:    returning.department,
          name:          returning.name,
          phone:         returning.phone,
          email:         returning.email,
          purpose:       finalPurpose,
          contactPerson: contactPerson,
          contactPersonId: null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'チェックインに失敗しました')
      }

      const { visitId, visitorId } = await res.json()

      // visitorId を更新（デバイス記憶を最新に）
      if (visitorId) localStorage.setItem('reception-visitor-id', visitorId)

      // sessionStorage クリア
      sessionStorage.removeItem('reception-returning-visitor')
      sessionStorage.setItem('reception-visit-id', visitId)
      localStorage.setItem('reception-visitor-token', params.token)

      router.push(`/r/${params.token}/done`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
      setSubmitting(false)
    }
  }

  if (!returning) {
    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--ge-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const showOther = purpose === 'その他'

  return (
    <div className="min-h-screen bg-[var(--ge-paper)]">
      {/* Header */}
      <div className="bg-[var(--ge-accent)] px-6 pt-10 pb-8 text-white relative">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {/* Step 2/2 (簡易フロー) */}
          <span className="w-6 h-1 rounded-full bg-white/40" />
          <span className="w-6 h-1 rounded-full bg-white" />
        </div>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-4 flex items-center gap-1">
          &larr; {locale === 'ja' ? '戻る' : 'Back'}
        </button>
        <h1 className="text-xl font-semibold">
          {locale === 'ja' ? '来訪目的を教えてください' : 'Visit Purpose'}
        </h1>
        <p className="text-sm text-white/60 mt-1">{returning.name} — {returning.company}</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8">
        {/* 来訪目的 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <p className="text-sm font-semibold text-[var(--ge-accent)] mb-3">
            {locale === 'ja' ? '来訪目的' : 'Purpose'} <span className="text-red-500">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {purposes.map(p => (
              <button
                key={p}
                onClick={() => setPurpose(p)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  purpose === p
                    ? 'bg-[var(--ge-accent)] text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {showOther && (
            <input
              type="text"
              value={purposeDetail}
              onChange={e => setPurposeDetail(e.target.value)}
              placeholder={locale === 'ja' ? '目的を入力...' : 'Enter purpose...'}
              className="mt-3 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-[var(--ge-accent)] focus:outline-none focus:border-[var(--ge-accent)]"
            />
          )}
        </div>

        {/* 担当者 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <p className="text-sm font-semibold text-[var(--ge-accent)] mb-3">
            {locale === 'ja' ? '担当者' : 'Contact Person'} <span className="text-red-500">*</span>
          </p>

          {staff.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {staff.slice(0, 8).map(s => (
                  <button
                    key={s.id}
                    onClick={() => setContactPerson(s.name)}
                    className={`px-3 py-1.5 rounded-xl text-sm transition-colors ${
                      contactPerson === s.name
                        ? 'bg-[var(--ge-accent)] text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={contactPerson}
                onChange={e => setContactPerson(e.target.value)}
                placeholder={locale === 'ja' ? '上記以外の場合はこちらに入力' : 'Or type a name'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-[var(--ge-accent)] focus:outline-none focus:border-[var(--ge-accent)]"
              />
            </>
          ) : (
            <input
              type="text"
              value={contactPerson}
              onChange={e => setContactPerson(e.target.value)}
              placeholder={locale === 'ja' ? '担当者のお名前' : 'Contact person name'}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-[var(--ge-accent)] focus:outline-none focus:border-[var(--ge-accent)]"
            />
          )}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 rounded-2xl p-4 mb-4 text-sm">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !purpose || (purpose === 'その他' && !purposeDetail.trim()) || !contactPerson.trim()}
          className="w-full py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <span>&#x1F6AA;</span>
          {submitting
            ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : (locale === 'ja' ? 'チェックイン' : 'Check In')}
        </button>
      </div>
    </div>
  )
}
