'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'
import {
  THEME,
  ReceptionShell,
  OptionCard,
  FaceIcon,
  QrScanIcon,
  NewPersonIcon,
} from '../reception-shell'

export default function CheckInChoicePage() {
  const params  = useParams<{ token: string }>()
  const { locale } = useLocale()
  const { announce } = useAnnounce()
  const theme   = THEME.checkin

  useEffect(() => { announce('reception') }, [announce])

  const ja = (j: string, e: string) => locale === 'ja' ? j : e

  return (
    <ReceptionShell
      token={params.token}
      themeKey="checkin"
      locale={locale}
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
