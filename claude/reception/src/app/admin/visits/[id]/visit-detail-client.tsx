'use client'

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
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    checked_in: 'bg-emerald-50 text-emerald-700',
    checked_out: 'bg-gray-100 text-gray-600',
    auto_closed: 'bg-yellow-50 text-yellow-700',
  }
  const labelKeys: Record<string, string> = {
    checked_in: 'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${styles[status] || ''}`}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

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

  const ocrPhoto = photos.find(p => p.ocrResult)

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
        <StatusBadge status={visitInfo.status} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Visit info */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.visitDetail')}</h2>
          <dl className="space-y-3 text-sm">
            <InfoRow label={t('admin.visitPurpose')} value={visitInfo.purpose} />
            <InfoRow label={t('admin.store')} value={visitInfo.storeName} />
            <InfoRow label={t('admin.area')} value={visitInfo.areaName} />
            <InfoRow
              label={t('admin.checkInTime')}
              value={new Date(visitInfo.checkInAt).toLocaleString(dateLocale)}
            />
            <InfoRow
              label={t('admin.checkOutTime')}
              value={visitInfo.checkOutAt ? new Date(visitInfo.checkOutAt).toLocaleString(dateLocale) : '—'}
            />
            {visitInfo.phone && <InfoRow label={t('admin.phone')} value={visitInfo.phone} />}
            {visitInfo.email && <InfoRow label={t('admin.email')} value={visitInfo.email} />}
          </dl>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.photos')}</h2>
          {photos.length === 0 ? (
            <p className="text-gray-400 text-sm">{t('admin.noPhotos')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {photos.map(photo => {
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

          {/* OCR results */}
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

      {/* Baggage declarations */}
      {baggageDeclarations.length > 0 && (
        <div className="mt-6 space-y-4">
          {baggageDeclarations.map(bd => (
            <div key={bd.id} className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-semibold text-[#1e3a5f] mb-4">
                🧳 手荷物検査 — {bd.context === 'checkin' ? '入室時' : '退室時'}
              </h2>
              {bd.inspection_mode === 'video' ? (
                <div>
                  {/* 録画ビューアーへのリンクカード */}
                  <Link
                    href={recordingHref(bd.id, visitId)}
                    className="group block bg-gray-900 rounded-xl overflow-hidden mb-4 hover:ring-2 hover:ring-violet-500 transition-all"
                  >
                    <div className="aspect-video flex flex-col items-center justify-center relative">
                      {/* グリッド背景 */}
                      <div className="absolute inset-0 opacity-10"
                        style={{
                          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
                          backgroundSize: '40px 40px',
                        }}
                      />
                      {/* REC バッジ */}
                      <div className="absolute top-3 left-3 text-[10px] text-white/70 font-mono bg-black/50 rounded px-2 py-0.5">
                        🔴 REC · i-PRO Remo
                      </div>
                      {/* 時刻 */}
                      <div className="absolute top-3 right-3 text-[10px] text-white/60 font-mono bg-black/50 rounded px-2 py-0.5">
                        {new Date(visitInfo.checkInAt).toLocaleString(dateLocale)} ± 5分
                      </div>
                      {/* 再生ボタン */}
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
                  {bd.declaration_text && (
                    <div className="p-3 bg-[#f0f2f5] rounded-xl">
                      <p className="text-xs text-gray-500 mb-1 font-medium">申告内容</p>
                      <p className="text-sm text-gray-700">{bd.declaration_text}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-400 mb-2">写真は上部のフォトセクションに表示されます</p>
                  {bd.declaration_text && (
                    <div className="p-3 bg-[#f0f2f5] rounded-xl">
                      <p className="text-xs text-gray-500 mb-1 font-medium">申告内容</p>
                      <p className="text-sm text-gray-700">{bd.declaration_text}</p>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-gray-400">ステータス:</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  bd.status === 'cleared' ? 'bg-green-50 text-green-700' :
                  bd.status === 'flagged' ? 'bg-red-50 text-red-700' :
                  'bg-yellow-50 text-yellow-700'
                }`}>
                  {bd.status === 'cleared' ? '✓ 済' : bd.status === 'flagged' ? '🚩 フラグ' : '⚠️ 未審査'}
                </span>
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
