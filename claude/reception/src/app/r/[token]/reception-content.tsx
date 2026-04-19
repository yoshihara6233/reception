'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

interface AreaSettings {
  require_business_card: string   // 'required' | 'optional' | 'hidden'
  require_face_photo: string      // 'required' | 'optional' | 'hidden'
  visit_purposes: string[]
}

interface Props {
  token: string
  storeName: string
  areaName: string
  preToken?: string  // pre-registration token from ?pre= query param
}

export function ReceptionContent({ token, storeName, areaName, preToken }: Props) {
  const { locale, t } = useLocale()
  const router = useRouter()
  const { announce } = useAnnounce()
  const [areaSettings, setAreaSettings] = useState<AreaSettings | null>(null)

  // ページ表示時にアナウンス
  useEffect(() => {
    announce('reception')
  }, [announce])

  // 店舗設定を取得して sessionStorage に保存
  useEffect(() => {
    fetch(`/api/v1/area-settings?token=${token}`)
      .then(r => r.ok ? r.json() : { settings: null })
      .then(data => {
        if (data.settings) {
          setAreaSettings(data.settings)
          // 来訪者フロー全体で参照できるよう sessionStorage に保存
          sessionStorage.setItem('reception-area-settings', JSON.stringify(data.settings))
        }
      })
      .catch(() => {})
  }, [token])

  // 事前登録QRでアクセスした場合: アクション選択をスキップして直接同意→登録へ
  useEffect(() => {
    if (preToken) {
      router.replace(`/r/${token}/consent?pre=${preToken}`)
    }
  }, [preToken, token, router])

  // CHECK IN ボタン押下: 同意ページを経由して次へ（同意が不要な場合は同意ページ内でスキップ）
  const handleCheckIn = () => {
    router.push(`/r/${token}/consent`)
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-12 pb-10 text-white text-center relative">
        <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center mx-auto mb-3">
          <span className="text-xl">&#x1F6E1;</span>
        </div>
        <h1 className="text-lg font-semibold tracking-wide">{storeName}</h1>
        <p className="text-sm opacity-70 mt-1">{areaName}</p>
        <div className="inline-flex items-center gap-1 mt-3 px-3 py-1 bg-emerald-500/20 rounded-full text-xs text-emerald-300">
          &#x2713; Secure Check-in
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      {/* Content */}
      <div className="px-5 -mt-1 flex-1">
        {/* Welcome card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 bg-indigo-50 rounded-xl flex items-center justify-center text-xl">
              &#x1F464;
            </div>
            <h2 className="text-[17px] font-semibold text-[#1e3a5f]">
              {locale === 'ja' ? 'ご来訪ありがとうございます' : `Welcome to ${storeName}`}
            </h2>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            {locale === 'ja'
              ? <>入室・退室の手続きを行います。<br />下のボタンから該当する手続きをお選びください。</>
              : t('reception.selectAction')}
          </p>
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <button
            onClick={handleCheckIn}
            className="flex items-center justify-between w-full px-5 py-[18px] bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-xl">&#x1F6AA;</span>
              {locale === 'ja' ? '入室 / CHECK IN' : t('reception.checkIn')}
            </span>
            <span className="opacity-60">&rarr;</span>
          </button>
          <Link
            href={`/r/${token}/checkout`}
            className="flex items-center justify-between w-full px-5 py-[18px] bg-white text-[#1e3a5f] border-2 border-[#1e3a5f] rounded-[14px] text-base font-semibold"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-xl">&#x1F6B6;</span>
              {locale === 'ja' ? '退室 / CHECK OUT' : t('reception.checkOut')}
            </span>
            <span className="opacity-60">&rarr;</span>
          </Link>

          {/* 事前登録QRをお持ちの方 */}
          <Link
            href={`/r/${token}/scan`}
            className="flex items-center justify-between w-full px-5 py-4 bg-white/80 text-[#1e3a5f] border border-[#1e3a5f]/30 rounded-[14px] text-sm font-medium"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-lg">&#x1F4F1;</span>
              {locale === 'ja' ? '事前登録QRをお持ちの方はこちら' : 'Have a pre-registration QR?'}
            </span>
            <span className="opacity-40 text-xs">QR</span>
          </Link>
        </div>

        {/* Security note */}
        <div className="flex items-center justify-center gap-2 mt-5 text-sm text-gray-400">
          <span>&#x1F512;</span>
          <span>
            {locale === 'ja'
              ? 'データは暗号化して安全に管理されます'
              : 'Your data is encrypted and securely managed'}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[#1e3a5f] py-5 text-center mt-auto">
        <p className="text-[11px] text-white/50 tracking-widest uppercase">
          Powered by Reception Kiosk
        </p>
      </div>
    </div>
  )
}
