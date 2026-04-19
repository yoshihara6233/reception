'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'

interface PreRegistration {
  id: string
  visitorCompany: string
  visitorName: string
  visitorEmail: string | null
  visitorPhone: string | null
  purpose: string
  contactPersonId: string | null
  expiresAt: string
  areaQrToken: string
  areaName: string
  storeName: string
}

export default function PreRegistrationPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { locale } = useLocale()
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  const [preReg, setPreReg] = useState<PreRegistration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/pre-registrations?token=${params.token}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) {
          setError(body.error || 'エラーが発生しました')
          setErrorCode(body.code || null)
          return
        }
        setPreReg(body.preRegistration)
      })
      .catch(() => setError('通信エラーが発生しました'))
      .finally(() => setLoading(false))
  }, [params.token])

  // Render QR code once preReg data is loaded
  useEffect(() => {
    if (!preReg || !qrCanvasRef.current) return

    const kioskUrl = `${window.location.origin}/r/${preReg.areaQrToken}?pre=${params.token}`

    // Dynamically load qrcode library
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js'
    script.onload = () => {
      // @ts-ignore
      window.QRCode.toCanvas(
        qrCanvasRef.current,
        kioskUrl,
        { width: 220, margin: 2, color: { dark: '#1e3a5f', light: '#ffffff' } },
        (err: Error | null) => {
          if (err) console.warn('QR render error:', err)
        }
      )
    }
    document.head.appendChild(script)
  }, [preReg, params.token])

  const handleCheckIn = () => {
    if (!preReg) return
    router.push(`/r/${preReg.areaQrToken}?pre=${params.token}`)
  }

  const handleCopyUrl = () => {
    if (!preReg) return
    const url = `${window.location.origin}/r/${preReg.areaQrToken}?pre=${params.token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const expiresLabel = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    const iconMap: Record<string, string> = {
      used: '✅',
      expired: '⏰',
      cancelled: '❌',
    }
    const icon = errorCode ? iconMap[errorCode] || '⚠️' : '⚠️'
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">{icon}</div>
          <h1 className="text-lg font-semibold text-[#1e3a5f] mb-2">
            {errorCode === 'used'
              ? locale === 'ja' ? '使用済みです' : 'Already Used'
              : errorCode === 'expired'
              ? locale === 'ja' ? '有効期限切れ' : 'Expired'
              : errorCode === 'cancelled'
              ? locale === 'ja' ? 'キャンセル済み' : 'Cancelled'
              : locale === 'ja' ? '無効なリンク' : 'Invalid Link'}
          </h1>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400 mt-3">
            {locale === 'ja'
              ? 'ご不明な点はスタッフにお声がけください'
              : 'Please contact a staff member for assistance'}
          </p>
        </div>
      </div>
    )
  }

  if (!preReg) return null

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-12 pb-8 text-white relative">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🎫</span>
          <h1 className="text-lg font-semibold">
            {locale === 'ja' ? '事前登録' : 'Pre-Registration'}
          </h1>
        </div>
        <p className="text-sm text-white/60">{preReg.storeName} / {preReg.areaName}</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8 space-y-4">
        {/* Visitor info card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {locale === 'ja' ? '来訪者情報' : 'Visitor Info'}
          </p>
          <div className="space-y-2.5">
            <InfoRow label={locale === 'ja' ? '会社名' : 'Company'} value={preReg.visitorCompany} />
            <InfoRow label={locale === 'ja' ? 'お名前' : 'Name'} value={preReg.visitorName} />
            <InfoRow
              label={locale === 'ja' ? '訪問目的' : 'Purpose'}
              value={preReg.purpose}
            />
            {preReg.visitorEmail && (
              <InfoRow label={locale === 'ja' ? 'メール' : 'Email'} value={preReg.visitorEmail} />
            )}
            {preReg.visitorPhone && (
              <InfoRow label={locale === 'ja' ? '電話' : 'Phone'} value={preReg.visitorPhone} />
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-400">
            <span>⏰</span>
            <span>
              {locale === 'ja' ? '有効期限：' : 'Expires: '}{expiresLabel(preReg.expiresAt)}
            </span>
          </div>
        </div>

        {/* QR Code card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {locale === 'ja' ? 'キオスクにこのQRを提示' : 'Show this QR at the kiosk'}
          </p>
          <div className="flex justify-center mb-3">
            <div className="p-3 bg-white rounded-xl border border-gray-100 inline-block">
              <canvas ref={qrCanvasRef} />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            {locale === 'ja'
              ? 'キオスク端末のカメラにかざしてください'
              : 'Hold up to the kiosk camera'}
          </p>
        </div>

        {/* Direct check-in button */}
        <button
          onClick={handleCheckIn}
          className="w-full py-4 bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold flex items-center justify-center gap-2"
        >
          <span className="text-lg">🚪</span>
          {locale === 'ja' ? 'このデバイスで入室手続きをする' : 'Check in on this device'}
        </button>

        {/* Copy URL */}
        <button
          onClick={handleCopyUrl}
          className="w-full py-3 bg-white border border-gray-200 text-[#1e3a5f] rounded-[14px] text-sm font-medium flex items-center justify-center gap-2"
        >
          <span>{copied ? '✅' : '📋'}</span>
          {copied
            ? (locale === 'ja' ? 'コピーしました' : 'Copied!')
            : (locale === 'ja' ? 'リンクをコピー' : 'Copy Link')}
        </button>

        <p className="text-xs text-center text-gray-400">
          {locale === 'ja'
            ? 'このリンクは1回のみ使用できます'
            : 'This link can only be used once'}
        </p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className="text-sm font-medium text-[#1e3a5f] text-right">{value}</span>
    </div>
  )
}
