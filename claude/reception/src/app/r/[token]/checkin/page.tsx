'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import {
  THEME,
  ReceptionShell,
  ReturningBanner,
  OptionCard,
  FaceIcon,
  QrScanIcon,
  NewPersonIcon,
} from '../reception-shell'

interface ReturningVisitor {
  name: string
  lastVisit: string | null
}

export default function CheckInChoicePage() {
  const params  = useParams<{ token: string }>()
  const { locale } = useLocale()
  const theme   = THEME.checkin
  const [returning, setReturning] = useState<ReturningVisitor | null>(null)

  const ja = (j: string, e: string) => locale === 'ja' ? j : e

  // ── リピーター検知 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const visitorId = localStorage.getItem('reception-visitor-id')
    if (!visitorId) return

    fetch(`/api/v1/visitors/me?token=${params.token}&visitorId=${visitorId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.visitor) {
          setReturning({ name: data.visitor.name, lastVisit: data.lastVisit?.date ?? null })
        }
      })
      .catch(() => {})
  }, [params.token])

  return (
    <ReceptionShell
      token={params.token}
      themeKey="checkin"
      locale={locale}
      returningBanner={
        returning ? (
          <ReturningBanner
            name={returning.name}
            lastVisit={returning.lastVisit}
            href={`/r/${params.token}/returning`}
            locale={locale}
            theme={theme}
          />
        ) : undefined
      }
    >
      {/* 顔認証 — primary */}
      <OptionCard
        href={`/r/${params.token}/face-auth?mode=checkin`}
        icon={<FaceIcon size={32} color="#fff" />}
        label={ja('顔認証でチェックイン', 'Face ID Check-In')}
        sub={ja('登録済みの方はすぐに入室できます', 'Instant entry for registered visitors')}
        tag="推奨"
        variant="primary"
        theme={theme}
      />

      {/* QRコード — secondary */}
      <OptionCard
        href={`/r/${params.token}/scan?mode=checkin`}
        icon={<QrScanIcon size={32} color={theme.accent} />}
        label={ja('QRコードで入室', 'QR Code Check-In')}
        sub={ja('メールで届いたQRコードをスキャン', 'Scan the QR code from your email')}
        tag="QR"
        variant="secondary"
        theme={theme}
      />

      {/* はじめての方 — ghost */}
      <OptionCard
        href={`/r/${params.token}/consent`}
        icon={<NewPersonIcon size={32} color="#64748b" />}
        label={ja('はじめての方', 'New Visitor')}
        sub={ja('フォームに情報を入力して入室', 'Fill in the form to check in')}
        variant="ghost"
        theme={theme}
      />
    </ReceptionShell>
  )
}
