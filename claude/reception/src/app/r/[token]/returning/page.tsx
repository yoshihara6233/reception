'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'

interface VisitorInfo {
  id:         string
  name:       string
  company:    string
  department: string
  phone:      string
  email:      string
}

interface LastVisit {
  date:          string
  purpose:       string
  contactPerson: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}月${day}日`
}

export default function ReturningPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { locale } = useLocale()

  const [visitor, setVisitor]   = useState<VisitorInfo | null>(null)
  const [lastVisit, setLastVisit] = useState<LastVisit | null>(null)
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ company: '', department: '', phone: '', email: '' })

  useEffect(() => {
    const visitorId = localStorage.getItem('reception-visitor-id')
    if (!visitorId) {
      // localStorage になければ通常フローへ
      router.replace(`/r/${params.token}/consent`)
      return
    }

    fetch(`/api/v1/visitors/me?token=${params.token}&visitorId=${visitorId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.visitor) {
          // 取得失敗 → 通常フロー
          localStorage.removeItem('reception-visitor-id')
          router.replace(`/r/${params.token}/consent`)
          return
        }
        setVisitor(data.visitor)
        setLastVisit(data.lastVisit)
        setEditForm({
          company:    data.visitor.company,
          department: data.visitor.department,
          phone:      data.visitor.phone,
          email:      data.visitor.email,
        })
        setLoading(false)
      })
      .catch(() => {
        router.replace(`/r/${params.token}/consent`)
      })
  }, [params.token, router])

  const handleSaveEdit = async () => {
    if (!visitor || saving) return
    setSaving(true)
    setSaveError(null)

    const res = await fetch('/api/v1/visitors/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:      params.token,
        visitorId:  visitor.id,
        company:    editForm.company,
        department: editForm.department,
        phone:      editForm.phone,
        email:      editForm.email,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setSaveError(body.error || '更新に失敗しました')
      setSaving(false)
      return
    }

    // ローカルの visitor を更新して view モードへ
    setVisitor(prev => prev ? { ...prev, ...editForm } : prev)
    setEditing(false)
    setSaving(false)
  }

  const handleContinue = () => {
    if (!visitor || !lastVisit) return
    // quick-checkin に前回情報を渡す
    sessionStorage.setItem('reception-returning-visitor', JSON.stringify({
      visitorId:         visitor.id,
      name:              visitor.name,
      company:           visitor.company,
      department:        visitor.department,
      phone:             visitor.phone,
      email:             visitor.email,
      lastPurpose:       lastVisit?.purpose ?? '',
      lastContactPerson: lastVisit?.contactPerson ?? '',
    }))
    router.push(`/r/${params.token}/returning/quick-checkin`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--ge-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!visitor) return null

  return (
    <div className="min-h-screen bg-[var(--ge-paper)]">
      {/* Header */}
      <div className="bg-[var(--ge-accent)] px-6 pt-10 pb-8 text-white relative">
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-4 flex items-center gap-1">
          &larr; {locale === 'ja' ? '戻る' : 'Back'}
        </button>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-3xl">👋</span>
          <h1 className="text-xl font-semibold">
            {locale === 'ja' ? `お帰りなさい！` : `Welcome back!`}
          </h1>
        </div>
        <p className="text-sm text-white/70 ml-11">
          {visitor.name}{locale === 'ja' ? ' さん' : ''}
          {lastVisit && (
            <span className="ml-2 text-white/50 text-xs">
              {locale === 'ja'
                ? `前回来訪: ${formatDate(lastVisit.date)}`
                : `Last visit: ${formatDate(lastVisit.date)}`}
            </span>
          )}
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8">
        {/* 来訪者情報カード */}
        <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {locale === 'ja' ? '登録情報' : 'Your Info'}
            </p>

            {!editing ? (
              /* View モード */
              <div className="space-y-2.5">
                <InfoRow label={locale === 'ja' ? '会社名' : 'Company'}    value={visitor.company}    />
                <InfoRow label={locale === 'ja' ? 'お名前' : 'Name'}        value={visitor.name}       />
                {visitor.department && <InfoRow label={locale === 'ja' ? '部署' : 'Dept'} value={visitor.department} />}
                {visitor.phone && <InfoRow label={locale === 'ja' ? '電話番号' : 'Phone'} value={visitor.phone} />}
                {visitor.email && <InfoRow label="Email" value={visitor.email} />}
              </div>
            ) : (
              /* Edit モード */
              <div className="space-y-3">
                <EditField
                  label={locale === 'ja' ? '会社名' : 'Company'}
                  value={editForm.company}
                  onChange={v => setEditForm(f => ({ ...f, company: v }))}
                  required
                />
                <EditField
                  label={locale === 'ja' ? '部署名' : 'Department'}
                  value={editForm.department}
                  onChange={v => setEditForm(f => ({ ...f, department: v }))}
                />
                <EditField
                  label={locale === 'ja' ? '電話番号' : 'Phone'}
                  value={editForm.phone}
                  onChange={v => setEditForm(f => ({ ...f, phone: v }))}
                  type="tel"
                />
                <EditField
                  label="Email"
                  value={editForm.email}
                  onChange={v => setEditForm(f => ({ ...f, email: v }))}
                  type="email"
                />
                {/* 氏名変更は通常フローへ */}
                <p className="text-xs text-gray-400">
                  {locale === 'ja'
                    ? '※ お名前を変更する場合は通常フォームからお手続きください'
                    : '* To change your name, please use the standard check-in flow'}
                </p>

                {saveError && (
                  <p className="text-red-500 text-xs">{saveError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setEditing(false); setSaveError(null) }}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-500 text-sm rounded-xl"
                  >
                    {locale === 'ja' ? 'キャンセル' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editForm.company.trim()}
                    className="flex-1 py-2.5 bg-[var(--ge-accent)] text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                  >
                    {saving
                      ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : (locale === 'ja' ? '変更を保存' : 'Save')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="w-full py-3 text-[var(--ge-accent)] text-sm font-medium border-t border-gray-100"
            >
              {locale === 'ja' ? '情報を変更する ▼' : 'Edit my info ▼'}
            </button>
          )}
        </div>

        {/* 前回来訪コンテキスト */}
        {lastVisit && (
          <div className="bg-indigo-50 rounded-2xl px-5 py-4 mb-4 border border-indigo-100">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1.5">
              {locale === 'ja' ? '前回の来訪' : 'Last Visit'}
            </p>
            <p className="text-sm text-indigo-800">
              <span className="font-medium">{lastVisit.purpose}</span>
              {lastVisit.contactPerson && (
                <span className="text-indigo-500 ml-2">/ {lastVisit.contactPerson}</span>
              )}
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleContinue}
          className="w-full py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold flex items-center justify-center gap-2 mb-3"
        >
          <span>&#x1F6AA;</span>
          {locale === 'ja' ? 'この情報で続ける' : 'Continue with this info'}
          <span className="opacity-60">&rarr;</span>
        </button>

        <button
          onClick={() => router.replace(`/r/${params.token}/consent`)}
          className="w-full py-3 text-gray-400 text-sm"
        >
          {locale === 'ja' ? '別の方はこちら（通常フロー）' : 'Different person? Use standard flow'}
        </button>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-400 w-24 shrink-0">{label}</span>
      <span className="text-sm font-medium text-[var(--ge-accent)] text-right">{value}</span>
    </div>
  )
}

function EditField({
  label, value, onChange, required, type = 'text',
}: {
  label:    string
  value:    string
  onChange: (v: string) => void
  required?: boolean
  type?:    string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-[var(--ge-accent)] focus:outline-none focus:border-[var(--ge-accent)]"
      />
    </div>
  )
}
