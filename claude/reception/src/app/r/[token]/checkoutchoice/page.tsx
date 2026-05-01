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

export default function CheckOutChoicePage() {
  const params  = useParams<{ token: string }>()
  const { locale } = useLocale()
  const { announce } = useAnnounce()
  const theme   = THEME.checkout

  const ja = (j: string, e: string) => locale === 'ja' ? j : e

  useEffect(() => { announce('checkout') }, [announce])

  return (
    <ReceptionShell
      token={params.token}
      themeKey="checkout"
      locale={locale}
    >
      {/* 顔認証 — primary */}
      <OptionCard
        href={`/r/${params.token}/face-auth?mode=checkout`}
        icon={<FaceIcon size={32} color="#fff" />}
        label={ja('顔認証で退室', 'Face ID Check-Out')}
        sub={ja('カメラで顔をスキャンして退室', 'Scan your face to check out')}
        tag="推奨"
        variant="primary"
        theme={theme}
      />

      {/* QRコード — secondary */}
      <OptionCard
        href={`/r/${params.token}/scan?mode=checkout`}
        icon={<QrScanIcon size={32} color={theme.accent} />}
        label={ja('QRコードで退室', 'QR Code Check-Out')}
        sub={ja('入室時のQRコードをスキャン', 'Scan your check-in QR code')}
        tag="QR"
        variant="secondary"
        theme={theme}
      />

      {/* はじめての方 / 手動退室 — ghost */}
      <OptionCard
        href={`/r/${params.token}/checkout`}
        icon={<NewPersonIcon size={32} color="#64748b" />}
        label={ja('はじめての方・手動退室', 'Manual Check-Out')}
        sub={ja('お名前・情報を入力して退室', 'Enter your name to check out')}
        variant="ghost"
        theme={theme}
      />
    </ReceptionShell>
  )
}
