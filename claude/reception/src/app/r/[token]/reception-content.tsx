'use client'

import { useEffect } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

interface Props {
  token: string
  storeName: string
  areaName: string
  preToken?: string  // pre-registration token from ?pre= query param
}

export function ReceptionContent({ token, storeName, areaName, preToken }: Props) {
  const { locale } = useLocale()
  const { announce } = useAnnounce()

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
          // 来訪者フロー全体で参照できるよう sessionStorage に保存
          sessionStorage.setItem('reception-area-settings', JSON.stringify(data.settings))
        }
      })
      .catch(() => {})
  }, [token])

  // 事前登録QRでアクセスした場合: アクション選択をスキップして直接同意→登録へ
  useEffect(() => {
    if (preToken) {
      window.location.replace(`/r/${token}/consent?pre=${preToken}`)
    }
  }, [preToken, token])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--ge-paper)', color: 'var(--ge-ink)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--ge-line)',
        padding: '32px 20px 20px',
        background: '#fff',
        textAlign: 'center',
      }}>
        <h1 style={{ font: `700 22px/1.2 var(--font-sans)`, color: 'var(--ge-ink)', margin: 0 }}>
          {storeName}
        </h1>
        <p style={{ font: `400 12px/1.4 var(--font-sans)`, color: 'var(--ge-ink-3)', marginTop: 4 }}>
          {areaName}
        </p>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ font: `400 13px/1.6 var(--font-sans)`, color: 'var(--ge-ink-3)', marginBottom: 8 }}>
          {locale === 'ja' ? '入室・退室の手続きをお選びください' : 'Select check-in or check-out'}
        </p>

        {/* 入室 */}
        <a
          href={`/r/${token}/checkin`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 20px',
            background: 'var(--ge-accent)', color: '#fff',
            borderRadius: 6, textDecoration: 'none',
            border: '1px solid transparent',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 4, flexShrink: 0,
              background: 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v18h-6M10 17l5-5-5-5M15 12H3"/>
              </svg>
            </span>
            <span>
              <span style={{ display: 'block', font: `600 15px/1.3 var(--font-sans)` }}>
                {locale === 'ja' ? '入室' : 'Check In'}
              </span>
              <span style={{ display: 'block', marginTop: 3, font: `400 11px/1.4 var(--font-sans)`, color: 'rgba(255,255,255,0.6)' }}>
                {locale === 'ja' ? 'はじめての方・リピーターの方' : 'New & returning visitors'}
              </span>
            </span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </a>

        {/* 退室 */}
        <a
          href={`/r/${token}/checkoutchoice`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 20px',
            background: '#fff', color: 'var(--ge-ink)',
            borderRadius: 6, textDecoration: 'none',
            border: '1px solid var(--ge-line)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 4, flexShrink: 0,
              background: 'var(--ge-paper-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ge-ink-2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H3V3h6M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </span>
            <span>
              <span style={{ display: 'block', font: `600 15px/1.3 var(--font-sans)` }}>
                {locale === 'ja' ? '退室' : 'Check Out'}
              </span>
              <span style={{ display: 'block', marginTop: 3, font: `400 11px/1.4 var(--font-sans)`, color: 'var(--ge-ink-3)' }}>
                {locale === 'ja' ? '退室手続きはこちら' : 'Complete your check-out'}
              </span>
            </span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ge-line-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </a>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--ge-line)',
        padding: '12px 20px',
        marginTop: 'auto',
      }}>
        <span style={{ font: `500 10px/1 var(--font-mono)`, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ge-ink-4)' }}>
          Genesis Edge · Reception
        </span>
      </div>
    </div>
  )
}
