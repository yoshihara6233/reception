'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

// visitId を URL に乗せて録画ページへ遷移するためのリンク生成
function recordingHref(baggageId: string, visitId: string) {
  return `/admin/baggage/${baggageId}/recording?visitId=${visitId}`
}

interface VisitInfo {
  purpose: string
  storeName?: string
  areaName?: string
  checkInAt: string
  checkOutAt?: string | null
  phone?: string
  email?: string
  status: string
}

interface Photo {
  id: string
  type: string
  signedUrl: string | null
  ocrResult?: unknown
}

interface BaggageDeclaration {
  id: string
  context: 'checkin' | 'checkout'
  inspection_mode: 'photo' | 'video' | null
  declaration_text: string | null
  status: string
  staff_notes: string | null
  reviewed_at: string | null
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
}

// ── 審査ステータスバッジ ────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '審査待ち', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  flagged:  { label: '🚩 フラグ', cls: 'bg-red-50 text-red-700 border-red-200' },
  cleared:  { label: '✓ 問題なし', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  approved: { label: '✓ 承認',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  rejected: { label: '却下',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function BaggageStatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
      {s.label}
    </span>
  )
}

function VisitStatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    checked_in:  'bg-emerald-50 text-emerald-700',
    checked_out: 'bg-gray-100 text-gray-600',
    auto_closed: 'bg-yellow-50 text-yellow-700',
  }
  const labelKeys: Record<string, string> = {
    checked_in:  'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${styles[status] || ''}`}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

// ── 手荷物写真パネル ───────────────────────────────────────────────────────

function BaggagePhotoPanel({
  label, url, placeholder,
}: { label: string; url: string | null; placeholder: string }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs text-gray-400 font-medium mb-1.5">{label}</p>
      <div className="rounded-xl overflow-hidden bg-gray-100 aspect-[4/3] relative">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs flex-col gap-1">
            <span className="text-2xl opacity-30">📦</span>
            <span>{placeholder}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 審査コントロール ────────────────────────────────────────────────────────

function BaggageReviewControls({
  baggageId, currentStatus, staffNotes: initNotes, reviewedAt, onUpdated,
}: {
  baggageId: string
  currentStatus: string
  staffNotes: string | null
  reviewedAt: string | null
  onUpdated: (status: string, notes: string) => void
}) {
  const [status, setStatus] = useState(currentStatus)
  const [notes, setNotes] = useState(initNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const handleSave = async (newStatus: string) => {
    setSaving(true)
    try {
      await fetch(`/api/v1/admin/baggage/${baggageId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, staff_notes: notes || null }),
      })
      setStatus(newStatus)
      onUpdated(newStatus, notes)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <BaggageStatusBadge status={status} />
        {reviewedAt && (
          <span className="text-xs text-gray-400">
            {new Date(reviewedAt).toLocaleDateString('ja-JP')} 審査済
          </span>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          className="text-xs text-[#1e3a5f] border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 font-medium"
        >
          {open ? '閉じる' : '審査する'}
        </button>
      </div>

      {open && (
        <div className="mt-3 p-3 bg-gray-50 rounded-xl space-y-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="スタッフメモ（任意）"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleSave('cleared')}
              disabled={saving}
              className="flex-1 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-40 transition-colors"
            >
              ✓ 問題なし
            </button>
            <button
              onClick={() => handleSave('flagged')}
              disabled={saving}
              className="flex-1 py-2 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 disabled:opacity-40 transition-colors"
            >
              🚩 フラグ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────

export function VisitDetailClient({
  visitId,
  visitorName,
  visitorCompany,
  visitInfo,
  photos,
  baggageDeclarations = [],
}: {
  visitId: string
  visitorName: string
  visitorCompany: string
  visitInfo: VisitInfo
  photos: Photo[]
  baggageDeclarations?: BaggageDeclaration[]
}) {
  const { t, locale } = useLocale()
  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  const [baggage, setBaggage] = useState(baggageDeclarations)

  const ocrPhoto = photos.find(p => p.ocrResult)
  // 顔・名刺写真のみ（手荷物写真は baggage_declarations から取得）
  const visitorPhotos = photos.filter(p => p.type === 'face' || p.type === 'card')

  const handleBaggageUpdated = (bdId: string, status: string, notes: string) => {
    setBaggage(prev => prev.map(bd =>
      bd.id === bdId
        ? { ...bd, status, staff_notes: notes, reviewed_at: new Date().toISOString() }
        : bd
    ))
  }

  return (
    <div>
      <Link href="/admin/visits" className="inline-flex items-center text-sm text-[#1e3a5f]/60 hover:text-[#1e3a5f] mb-4">
        ← {t('admin.backToVisits')}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">{visitorName}</h1>
          <p className="text-gray-500 mt-1">{visitorCompany}</p>
        </div>
        <VisitStatusBadge status={visitInfo.status} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 来訪情報 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.visitDetail')}</h2>
          <dl className="space-y-3 text-sm">
            <InfoRow label={t('admin.visitPurpose')} value={visitInfo.purpose} />
            <InfoRow label={t('admin.store')}        value={visitInfo.storeName} />
            <InfoRow label={t('admin.area')}         value={visitInfo.areaName} />
            <InfoRow
              label={t('admin.checkInTime')}
              value={new Date(visitInfo.checkInAt).toLocaleString(dateLocale)}
            />
            <InfoRow
              label={t('admin.checkOutTime')}
              value={visitInfo.checkOutAt
                ? new Date(visitInfo.checkOutAt).toLocaleString(dateLocale)
                : '—'}
            />
            {visitInfo.phone && <InfoRow label={t('admin.phone')} value={visitInfo.phone} />}
            {visitInfo.email && <InfoRow label={t('admin.email')} value={visitInfo.email} />}
          </dl>
        </div>

        {/* 来訪者写真（顔・名刺） */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.photos')}</h2>
          {visitorPhotos.length === 0 ? (
            <p className="text-gray-400 text-sm">{t('admin.noPhotos')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visitorPhotos.map(photo => {
                const label = photo.type === 'card' ? t('admin.businessCard') : t('admin.facePhoto')
                return (
                  <div key={photo.id} className="rounded-xl overflow-hidden bg-[#f0f2f5] aspect-[4/3] relative">
                    {photo.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.signedUrl} alt={label} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                        {label}
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {ocrPhoto && (
            <div className="mt-4 p-3 bg-[#f0f2f5] rounded-xl">
              <p className="text-xs text-gray-500 mb-2 font-medium">{t('admin.ocrResult')}</p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                {JSON.stringify(ocrPhoto.ocrResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* 手荷物検査セクション */}
      {baggage.length > 0 && (
        <div className="mt-6 space-y-4">
          {baggage.map(bd => (
            <div key={bd.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* ヘッダー */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🧳</span>
                  <h2 className="font-semibold text-[#1e3a5f]">
                    手荷物検査 — {bd.context === 'checkin' ? '入室時' : '退室時'}
                  </h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    bd.inspection_mode === 'video'
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {bd.inspection_mode === 'video' ? '🎥 動画' : '📷 写真'}
                  </span>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* 動画モード: 録画リンクカード */}
                {bd.inspection_mode === 'video' ? (
                  <Link
                    href={recordingHref(bd.id, visitId)}
                    className="group block bg-gray-900 rounded-xl overflow-hidden hover:ring-2 hover:ring-violet-500 transition-all"
                  >
                    <div className="aspect-video flex flex-col items-center justify-center relative">
                      <div className="absolute inset-0 opacity-10"
                        style={{
                          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
                          backgroundSize: '40px 40px',
                        }}
                      />
                      <div className="absolute top-3 left-3 text-[10px] text-white/70 font-mono bg-black/50 rounded px-2 py-0.5">
                        🔴 REC · i-PRO Remo
                      </div>
                      <div className="absolute top-3 right-3 text-[10px] text-white/60 font-mono bg-black/50 rounded px-2 py-0.5">
                        {new Date(visitInfo.checkInAt).toLocaleString(dateLocale)} ± 5分
                      </div>
                      <div className="w-16 h-16 rounded-full border-2 border-white/40 flex items-center justify-center text-white/70 group-hover:border-violet-400 group-hover:text-violet-400 transition-colors bg-black/20">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                      </div>
                      <p className="text-white/60 text-sm mt-3">録画を再生する</p>
                      <p className="text-white/40 text-xs mt-1 group-hover:text-violet-400 transition-colors">
                        クリックして録画ビューアーを開く →
                      </p>
                    </div>
                  </Link>
                ) : (
                  /* 写真モード: 手荷物写真インライン表示 */
                  <div className="flex gap-3">
                    <BaggagePhotoPanel
                      label="荷物の内容"
                      url={bd.photoContentsUrl}
                      placeholder="写真なし"
                    />
                    <BaggagePhotoPanel
                      label="バッグ外観（空）"
                      url={bd.photoEmptyUrl}
                      placeholder="写真なし"
                    />
                  </div>
                )}

                {/* 申告内容 */}
                {bd.declaration_text && (
                  <div className="p-3 bg-[#f0f4f8] rounded-xl">
                    <p className="text-xs text-gray-500 mb-1 font-medium">申告内容</p>
                    <p className="text-sm text-gray-700">{bd.declaration_text}</p>
                  </div>
                )}

                {/* 審査コントロール */}
                <BaggageReviewControls
                  baggageId={bd.id}
                  currentStatus={bd.status}
                  staffNotes={bd.staff_notes}
                  reviewedAt={bd.reviewed_at}
                  onUpdated={(status, notes) => handleBaggageUpdated(bd.id, status, notes)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-[#1e3a5f] font-medium">{value || '—'}</dd>
    </div>
  )
}
