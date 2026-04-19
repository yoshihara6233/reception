'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

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
  visitorName,
  visitorCompany,
  visitInfo,
  photos,
}: {
  visitorName: string
  visitorCompany: string
  visitInfo: VisitInfo
  photos: Photo[]
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
