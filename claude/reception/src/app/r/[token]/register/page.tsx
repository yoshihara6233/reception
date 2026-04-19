'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
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
  contactPersonId: string   // staff_members.id (empty = free text)
}

interface StaffSuggestion {
  id: string
  name: string
  name_kana: string | null
}

interface OcrResult {
  company: string
  department: string
  name: string
  phone: string
  email: string
  confidence: 'high' | 'medium' | 'low'
}

const DEFAULT_PURPOSES = [
  { value: '定期配送',     labelKey: 'register.purposeDelivery' },
  { value: 'メンテナンス', labelKey: 'register.purposeMaintenance' },
  { value: '商談',         labelKey: 'register.purposeMeeting' },
  { value: '監査',         labelKey: 'register.purposeAudit' },
  { value: 'その他',       labelKey: 'register.purposeOther' },
]

export default function RegisterPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preToken = searchParams.get('pre')   // pre-registration token
  const { t } = useLocale()
  const { announce } = useAnnounce()
  const [submitting, setSubmitting] = useState(false)
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set())
  const [purposes, setPurposes] = useState(DEFAULT_PURPOSES)
  const [staffSuggestions, setStaffSuggestions] = useState<StaffSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [preRegFilled, setPreRegFilled] = useState(false)   // show "事前登録情報で自動入力しました" banner
  const contactRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState<FormData>({
    company: '',
    department: '',
    name: '',
    phone: '',
    email: '',
    purpose: '',
    purposeDetail: '',
    contactPerson: '',
    contactPersonId: '',
  })

  // sessionStorage から店舗設定と OCR 結果を読み込む
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (raw) {
        const s = JSON.parse(raw)
        if (Array.isArray(s.visit_purposes) && s.visit_purposes.length > 0) {
          setPurposes(s.visit_purposes.map((v: string) => ({ value: v, labelKey: v })))
        }
      }
    } catch { /* ignore */ }
  }, [])

  // スタッフサジェストを取得（事前登録の contactPersonId 解決もここで行う）
  useEffect(() => {
    fetch(`/api/v1/areas/${params.token}/staff`)
      .then(r => r.ok ? r.json() : { staff: [] })
      .then(data => {
        const list: StaffSuggestion[] = data.staff ?? []
        setStaffSuggestions(list)
        // If a contactPersonId was saved from pre-registration, resolve the name now
        setForm(prev => {
          if (prev.contactPersonId && !prev.contactPerson) {
            const found = list.find(s => s.id === prev.contactPersonId)
            if (found) return { ...prev, contactPerson: found.name }
          }
          return prev
        })
      })
      .catch(() => {})
  }, [params.token])

  // サジェストドロップダウンを外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ページ表示時にアナウンス（announce は安定参照なので deps に含めても再実行は1回）
  useEffect(() => {
    const hasOcr = !!sessionStorage.getItem('reception-ocr-result')
    announce(hasOcr ? 'register-ocr' : 'register')
  }, [announce])

  // sessionStorage から OCR 結果を読み込んで自動入力
  useEffect(() => {
    const raw = sessionStorage.getItem('reception-ocr-result')
    if (!raw) return
    try {
      const ocr: OcrResult = JSON.parse(raw)
      setOcrResult(ocr)

      const filled = new Set<string>()
      const patch: Partial<FormData> = {}

      if (ocr.company)    { patch.company    = ocr.company;    filled.add('company')    }
      if (ocr.department) { patch.department = ocr.department; filled.add('department') }
      if (ocr.name)       { patch.name       = ocr.name;       filled.add('name')       }
      if (ocr.phone)      { patch.phone      = ocr.phone;      filled.add('phone')      }
      if (ocr.email)      { patch.email      = ocr.email;      filled.add('email')      }

      setForm(prev => ({ ...prev, ...patch }))
      setOcrFields(filled)
    } catch {
      // ignore parse errors
    }
  }, [])

  // 事前登録トークンがある場合: APIからデータ取得してフォームを自動入力
  useEffect(() => {
    if (!preToken) return
    fetch(`/api/v1/pre-registrations?token=${preToken}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.preRegistration) return
        const p = data.preRegistration
        setForm(prev => ({
          ...prev,
          company: p.visitorCompany || prev.company,
          name: p.visitorName || prev.name,
          phone: p.visitorPhone || prev.phone,
          email: p.visitorEmail || prev.email,
          purpose: p.purpose || prev.purpose,
          contactPersonId: p.contactPersonId || prev.contactPersonId,
        }))
        // contactPersonId will be resolved once staff suggestions are loaded (see effect below)
        setPreRegFilled(true)
        // Save pre_reg_id to sessionStorage for linking after check-in
        sessionStorage.setItem('reception-pre-reg-id', p.id)
      })
      .catch(() => { /* non-blocking */ })
  }, [preToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    // 手動編集したらOCRハイライトを外す
    setOcrFields(prev => { const s = new Set(prev); s.delete(field); return s })
  }

  const isValid = form.company.trim() && form.name.trim() && form.purpose

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || submitting) return
    setSubmitting(true)

    sessionStorage.setItem('reception-form', JSON.stringify({
      ...form,
      token: params.token,
      contactPersonId: form.contactPersonId || null,
    }))

    // OCR結果をクリア（次のステップで不要）
    sessionStorage.removeItem('reception-ocr-result')

    // 次: 顔写真 → confirm
    router.push(`/r/${params.token}/face`)
  }

  // OCRバナーの色
  const confidenceColor = ocrResult?.confidence === 'high'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : ocrResult?.confidence === 'medium'
    ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
    : 'bg-gray-50 border-gray-200 text-gray-600'

  const confidenceLabel = ocrResult?.confidence === 'high'
    ? '✅ 名刺を読み取りました。内容を確認してください。'
    : ocrResult?.confidence === 'medium'
    ? '⚠️ 一部読み取れない箇所があります。確認・修正してください。'
    : null

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* ヘッダー */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-10 pb-8 text-white relative">
        {/* ステップインジケーター */}
        <div className="flex items-center justify-center gap-1 mb-4">
          <span className="w-6 h-1 rounded-full bg-white/50" />
          <span className="w-6 h-1 rounded-full bg-white" />
          <span className="w-6 h-1 rounded-full bg-white/30" />
        </div>
        <button
          onClick={() => router.back()}
          className="text-white/60 text-sm mb-3 flex items-center gap-1"
        >
          &larr; 戻る
        </button>
        <h1 className="text-xl font-semibold">{t('register.title')}</h1>
        <p className="text-sm text-white/60 mt-1">
          {preRegFilled
            ? '🎫 事前登録情報で自動入力しました'
            : ocrFields.size > 0 ? '📋 名刺から自動入力しました' : 'Visitor Registration'}
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8">
        {/* 事前登録バナー */}
        {preRegFilled && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 mb-4 flex items-center gap-2">
            <span>🎫</span>
            <span>事前登録情報で自動入力しました。内容をご確認ください。</span>
          </div>
        )}

        {/* OCR バナー */}
        {!preRegFilled && confidenceLabel && (
          <div className={`rounded-xl border px-4 py-3 text-sm mb-4 ${confidenceColor}`}>
            {confidenceLabel}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 会社名 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">
              {t('register.company')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={form.company}
                onChange={e => update('company', e.target.value)}
                placeholder={t('register.companyPlaceholder')}
                className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent transition-colors ${
                  ocrFields.has('company') ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                }`}
                required
              />
              {ocrFields.has('company') && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">📋</span>
              )}
            </div>
          </div>

          {/* 氏名 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">
              {t('register.name')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder={t('register.namePlaceholder')}
                className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent transition-colors ${
                  ocrFields.has('name') ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                }`}
                required
              />
              {ocrFields.has('name') && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">📋</span>
              )}
            </div>
          </div>

          {/* 部署・電話・メール */}
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">
                {t('register.department')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={form.department}
                  onChange={e => update('department', e.target.value)}
                  placeholder={t('register.departmentPlaceholder')}
                  className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent transition-colors ${
                    ocrFields.has('department') ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                  }`}
                />
                {ocrFields.has('department') && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">📋</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">電話番号</label>
              <div className="relative">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => update('phone', e.target.value)}
                  placeholder="090-1234-5678"
                  className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent transition-colors ${
                    ocrFields.has('phone') ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                  }`}
                />
                {ocrFields.has('phone') && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">📋</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">メールアドレス</label>
              <div className="relative">
                <input
                  type="email"
                  value={form.email}
                  onChange={e => update('email', e.target.value)}
                  placeholder="taro@example.com"
                  className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent transition-colors ${
                    ocrFields.has('email') ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                  }`}
                />
                {ocrFields.has('email') && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">📋</span>
                )}
              </div>
            </div>
          </div>

          {/* 来訪目的 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-[#1e3a5f] mb-3">
              {t('register.purpose')} <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {purposes.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('purpose', p.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.purpose === p.value
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {t(p.labelKey)}
                </button>
              ))}
            </div>
            {form.purpose === 'その他' && (
              <input
                type="text"
                value={form.purposeDetail}
                onChange={e => update('purposeDetail', e.target.value)}
                placeholder="詳細を入力"
                className="w-full mt-3 px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            )}
          </div>

          {/* 訪問先担当者（スタッフサジェスト付き） */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">
              訪問先担当者
            </label>
            <div ref={contactRef} className="relative">
              <input
                type="text"
                value={form.contactPerson}
                onChange={e => {
                  update('contactPerson', e.target.value)
                  setForm(prev => ({ ...prev, contactPersonId: '' }))
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="鈴木 花子"
                className={`w-full px-4 py-3 border rounded-xl text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] transition-colors ${
                  form.contactPersonId ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'
                }`}
                autoComplete="off"
              />
              {form.contactPersonId && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">✓</span>
              )}
              {/* Suggestion dropdown */}
              {showSuggestions && staffSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {staffSuggestions
                    .filter(s =>
                      !form.contactPerson.trim() ||
                      s.name.includes(form.contactPerson) ||
                      (s.name_kana || '').includes(form.contactPerson)
                    )
                    .slice(0, 8)
                    .map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault()
                          setForm(prev => ({ ...prev, contactPerson: s.name, contactPersonId: s.id }))
                          setShowSuggestions(false)
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-900 hover:bg-[#1e3a5f]/5 border-b border-gray-50 last:border-0"
                      >
                        {s.name}
                        {s.name_kana && <span className="ml-2 text-xs text-gray-400">{s.name_kana}</span>}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* 送信 */}
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full py-4 bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? t('common.loading') : (
              <>{t('common.next')} <span className="opacity-60">&rarr;</span></>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
