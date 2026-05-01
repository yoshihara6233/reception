'use client'

/**
 * /r/[token]/purpose-select
 *
 * 顔認証・QRコード認証後に来訪目的を選択する画面。
 * sessionStorage の `reception-purpose-visitor` からビジター情報を読み込み、
 * 目的選択 + 担当者入力 → チェックイン API 呼び出し → done へ遷移する。
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

interface PurposeVisitor {
  visitorId:  string
  name:       string
  company:    string
  department: string
  phone:      string
  email:      string
  source:     'face-auth' | 'qr'
}

const DEFAULT_PURPOSES = ['商談', '打ち合わせ', 'メンテナンス', '工事・作業', '配送', 'その他']

export default function PurposeSelectPage() {
  const params  = useParams<{ token: string }>()
  const router  = useRouter()
  const { locale } = useLocale()
  const { announce } = useAnnounce()

  const [visitor, setVisitor]         = useState<PurposeVisitor | null>(null)
  const [purpose, setPurpose]         = useState('')
  const [purposeDetail, setPurposeDetail] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [staff, setStaff]             = useState<{ id: string; name: string }[]>([])
  const [purposes, setPurposes]       = useState(DEFAULT_PURPOSES)
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const ja = (j: string, e: string) => locale === 'ja' ? j : e

  useEffect(() => { announce('register') }, [announce])

  // sessionStorage からビジター情報を読み込む
  useEffect(() => {
    const raw = sessionStorage.getItem('reception-purpose-visitor')
    if (!raw) {
      router.replace(`/r/${params.token}`)
      return
    }
    try {
      setVisitor(JSON.parse(raw))
    } catch {
      router.replace(`/r/${params.token}`)
    }

    // エリア設定から来訪目的リストを取得
    try {
      const areaSettings = JSON.parse(sessionStorage.getItem('reception-area-settings') || '{}')
      if (Array.isArray(areaSettings.visit_purposes) && areaSettings.visit_purposes.length > 0) {
        setPurposes(areaSettings.visit_purposes)
      }
    } catch { /* ignore */ }
  }, [params.token, router])

  // スタッフリスト取得
  useEffect(() => {
    fetch(`/api/v1/areas/${params.token}/staff`)
      .then(r => r.ok ? r.json() : { staff: [] })
      .then(d => setStaff(d.staff ?? []))
      .catch(() => {})
  }, [params.token])

  const handleSubmit = async () => {
    if (!visitor || submitting) return
    if (!purpose) { setError(ja('来訪目的を選択してください', 'Please select a purpose')); return }

    setSubmitting(true)
    setError(null)

    const finalPurpose = purpose === 'その他' ? (purposeDetail.trim() || 'その他') : purpose

    try {
      const deviceToken = localStorage.getItem('reception-visitor-token')

      const res = await fetch('/api/v1/visits/check-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(deviceToken ? { 'x-device-token': deviceToken } : {}),
        },
        body: JSON.stringify({
          token:         params.token,
          visitorId:     visitor.visitorId,
          company:       visitor.company,
          department:    visitor.department,
          name:          visitor.name,
          phone:         visitor.phone,
          email:         visitor.email,
          purpose:       finalPurpose,
          contactPerson: contactPerson.trim() || null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'チェックインに失敗しました')
      }

      const { visitId, visitorId } = await res.json()

      // ローカル記憶を更新
      if (visitorId) localStorage.setItem('reception-visitor-id', visitorId)
      sessionStorage.setItem('reception-visit-id', visitId)
      localStorage.setItem('reception-visitor-token', params.token)
      sessionStorage.removeItem('reception-purpose-visitor')

      router.replace(`/r/${params.token}/done`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
      setSubmitting(false)
    }
  }

  if (!visitor) {
    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--ge-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const showOther = purpose === 'その他'

  return (
    <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col">
      {/* Header */}
      <div className="bg-[var(--ge-accent)] px-6 pt-10 pb-10 text-white relative">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => router.back()}
            className="text-white/60 text-sm flex items-center gap-1"
          >
            &larr; {ja('戻る', 'Back')}
          </button>
          <a href={`/r/${params.token}`} className="text-white/50 text-xs">
            受付トップへ ↑
          </a>
        </div>
        <h1 className="text-xl font-semibold">
          {ja('来訪目的をお教えください', 'Purpose of Visit')}
        </h1>
        <p className="text-sm text-white/70 mt-1">
          {visitor.name}
          {visitor.company ? ` — ${visitor.company}` : ''}
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 flex-1 pb-8 space-y-4">
        {/* 来訪目的 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-[var(--ge-accent)] mb-3">
            {ja('来訪目的', 'Purpose')} <span className="text-red-500 ml-0.5">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {purposes.map(p => (
              <button
                key={p}
                onClick={() => { setPurpose(p); setPurposeDetail('') }}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  purpose === p
                    ? 'bg-[var(--ge-accent)] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
              placeholder={ja('目的を入力してください', 'Enter purpose...')}
              autoFocus
              className="mt-3 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)] focus:border-transparent"
            />
          )}
        </div>

        {/* 担当者（任意） */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-[var(--ge-accent)] mb-3">
            {ja('担当者', 'Contact Person')}
            <span className="ml-2 text-xs font-normal text-gray-400">{ja('任意', 'Optional')}</span>
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
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                placeholder={ja('上記以外の場合はこちらに入力', 'Or type a name')}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)] focus:border-transparent"
              />
            </>
          ) : (
            <input
              type="text"
              value={contactPerson}
              onChange={e => setContactPerson(e.target.value)}
              placeholder={ja('担当者のお名前（任意）', 'Contact person name (optional)')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)] focus:border-transparent"
            />
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 text-sm">
            {error}
          </div>
        )}

        {/* チェックインボタン */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !purpose || (purpose === 'その他' && !purposeDetail.trim())}
          className="w-full py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2 shadow-sm"
        >
          {submitting
            ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <>
                <span className="text-xl">🚪</span>
                {ja('チェックイン', 'Check In')}
              </>
          }
        </button>
      </div>

      <div className="bg-[var(--ge-accent)] py-5 text-center mt-auto">
        <p className="text-[11px] text-white/50 tracking-widest uppercase">
          Powered by Reception Kiosk
        </p>
      </div>
    </div>
  )
}
