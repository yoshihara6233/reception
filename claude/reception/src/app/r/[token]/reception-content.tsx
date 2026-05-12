'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'
import { useKioskMode } from '@/lib/kiosk/useKioskMode'

// ── Genesis Edge brand tokens ─────────────────────────────────────────────────
const GE = {
  ink:        '#2C4A7E',   // GE Accent Indigo
  inkDark:    '#1B2F52',   // GE Accent Ink
  soft:       '#E4EAF3',   // GE Accent Soft
  line:       '#B8C4DA',   // GE Accent Line
  paper:      '#F7F5F1',
  paperDark:  '#EFEBE3',
  neutral:    '#5B5B5F',
  subtle:     '#8C8C90',
  border:     '#D6CFC1',
  success:    '#2F7A4F',   // for exit / checkout section
  successSoft:'#E3EFE6',
  successLine:'#A3C9B2',
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function FaceIcon({ size = 28, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="20" r="11" stroke={color} strokeWidth="2.2"/>
      <circle cx="19.5" cy="18.5" r="1.9" fill={color}/>
      <circle cx="28.5" cy="18.5" r="1.9" fill={color}/>
      <path d="M18.5 25c1.5 2.5 9.5 2.5 11 0" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 44c0-9 7-15 16-15s16 6 16 15" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  )
}

function QrIcon({ size = 28, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <rect x="6"  y="6"  width="13" height="13" rx="2"/>
      <rect x="9"  y="9"  width="7"  height="7"  rx="1" fill={color} stroke="none"/>
      <rect x="29" y="6"  width="13" height="13" rx="2"/>
      <rect x="32" y="9"  width="7"  height="7"  rx="1" fill={color} stroke="none"/>
      <rect x="6"  y="29" width="13" height="13" rx="2"/>
      <rect x="9"  y="32" width="7"  height="7"  rx="1" fill={color} stroke="none"/>
      <rect x="29" y="29" width="5"  height="5"  rx="1" fill={color} stroke="none"/>
      <rect x="36" y="29" width="6"  height="5"  rx="1" fill={color} stroke="none"/>
      <rect x="29" y="36" width="5"  height="6"  rx="1" fill={color} stroke="none"/>
      <rect x="36" y="36" width="6"  height="6"  rx="1" fill={color} stroke="none"/>
    </svg>
  )
}

function NewIcon({ size = 28, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="20" cy="17" r="8"/>
      <path d="M4 44c0-9 7-14 16-14"/>
      <circle cx="36" cy="36" r="9"/>
      <line x1="36" y1="31" x2="36" y2="41"/>
      <line x1="31" y1="36" x2="41" y2="36"/>
    </svg>
  )
}

function EnterIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v18h-6M10 17l5-5-5-5M15 12H3"/>
    </svg>
  )
}

function ExitIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H3V3h6M16 17l5-5-5-5M21 12H9"/>
    </svg>
  )
}

// ── Option row ────────────────────────────────────────────────────────────────

type RowVariant = 'primary' | 'secondary' | 'ghost'

interface OptionRowConfig {
  bg: string; border: string; color: string
  iconBg: string; subColor: string
  tagBg: string; tagColor: string; arrow: string
}

function OptionRow({
  href, icon, label, sub, tag, variant, cfg, kiosk,
}: {
  href: string; icon: React.ReactNode; label: string; sub: string
  tag?: string; variant: RowVariant; cfg: OptionRowConfig; kiosk?: boolean
}) {
  const iconW = kiosk ? 64 : 50
  const rowPadding = kiosk ? '20px 20px' : '14px 14px'
  const labelFont = kiosk ? '600 17px/1.3 var(--font-sans)' : '600 15px/1.3 var(--font-sans)'
  const subFont = kiosk ? '400 13px/1.5 var(--font-sans)' : '400 11px/1.5 var(--font-sans)'

  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: rowPadding,
        background: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        borderRadius: kiosk ? 16 : 12,
        textDecoration: 'none',
        color: cfg.color,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* icon */}
      <span style={{
        width: iconW, height: iconW, borderRadius: kiosk ? 14 : 10, flexShrink: 0,
        background: cfg.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </span>

      {/* text */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ font: labelFont }}>{label}</span>
          {tag && (
            <span style={{
              font: `600 10px/1 var(--font-mono)`, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: cfg.tagBg, color: cfg.tagColor,
            }}>{tag}</span>
          )}
        </span>
        <span style={{
          display: 'block', marginTop: 3,
          font: subFont,
          color: cfg.subColor,
        }}>{sub}</span>
      </span>

      {/* arrow */}
      <svg width={kiosk ? 18 : 14} height={kiosk ? 18 : 14} viewBox="0 0 24 24" fill="none"
        stroke={cfg.arrow} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0 }}>
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </a>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  icon, label, sub, accentColor, softColor, lineColor,
}: {
  icon: React.ReactNode; label: string; sub: string
  accentColor: string; softColor: string; lineColor: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      background: softColor,
      border: `1px solid ${lineColor}`,
      borderRadius: 10,
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        background: accentColor, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </span>
      <span>
        <span style={{ font: `700 14px/1.2 var(--font-sans)`, color: accentColor, display: 'block' }}>
          {label}
        </span>
        <span style={{ font: `400 10px/1 var(--font-sans)`, color: GE.neutral, marginTop: 2, display: 'block' }}>
          {sub}
        </span>
      </span>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  token: string
  storeName: string
  areaName: string
  preToken?: string
}

export function ReceptionContent({ token, storeName, areaName, preToken }: Props) {
  const { locale } = useLocale()
  const { announce } = useAnnounce()
  const [kioskMode, setKioskMode] = useState(false)

  const ja = (j: string, e: string, z: string = e, k: string = e) => {
    if (locale === 'zh') return z
    if (locale === 'ko') return k
    if (locale === 'ja') return j
    return e
  }

  useEffect(() => { announce('reception') }, [announce])

  useEffect(() => {
    fetch(`/api/v1/area-settings?token=${token}`)
      .then(r => r.ok ? r.json() : { settings: null })
      .then(data => {
        if (data.settings) {
          sessionStorage.setItem('reception-area-settings', JSON.stringify(data.settings))
          setKioskMode(!!data.settings.kiosk_mode)
        }
      })
      .catch(() => {})
  }, [token])

  // キオスクモード有効時: スリープ防止 + 2分無操作でTOPリセット
  useKioskMode({
    enableWakeLock: kioskMode,
    enableIdleReset: kioskMode,
    idleTimeoutMs: 120_000,
  })

  useEffect(() => {
    if (preToken) window.location.replace(`/r/${token}/consent?pre=${preToken}`)
  }, [preToken, token])

  // ── カード設定 ─────────────────────────────────────────────────────────────

  // 入室 primary (GE indigo)
  const inPrimary: OptionRowConfig = {
    bg: GE.ink, border: 'transparent', color: '#fff',
    iconBg: 'rgba(255,255,255,0.18)', subColor: 'rgba(255,255,255,0.62)',
    tagBg: 'rgba(255,255,255,0.2)', tagColor: '#fff', arrow: 'rgba(255,255,255,0.45)',
  }
  const inSecondary: OptionRowConfig = {
    bg: '#fff', border: GE.line, color: GE.inkDark,
    iconBg: GE.soft, subColor: GE.neutral,
    tagBg: GE.soft, tagColor: GE.ink, arrow: GE.border,
  }
  const inGhost: OptionRowConfig = {
    bg: GE.paper, border: GE.border, color: '#1e293b',
    iconBg: '#fff', subColor: GE.subtle,
    tagBg: GE.paperDark, tagColor: GE.neutral, arrow: GE.border,
  }

  // 退室 primary (GE success green)
  const outPrimary: OptionRowConfig = {
    bg: GE.success, border: 'transparent', color: '#fff',
    iconBg: 'rgba(255,255,255,0.18)', subColor: 'rgba(255,255,255,0.62)',
    tagBg: 'rgba(255,255,255,0.2)', tagColor: '#fff', arrow: 'rgba(255,255,255,0.45)',
  }
  const outSecondary: OptionRowConfig = {
    bg: '#fff', border: GE.successLine, color: GE.success,
    iconBg: GE.successSoft, subColor: GE.neutral,
    tagBg: GE.successSoft, tagColor: GE.success, arrow: GE.border,
  }

  // タブレット（キオスク）向けのサイズ調整
  const pad = kioskMode ? 24 : 14
  const headingSize = kioskMode ? '26px' : '20px'
  const subSize = kioskMode ? '15px' : '12px'
  const rowPad = kioskMode ? '20px 20px' : '14px 14px'
  const iconSize = kioskMode ? 60 : 50
  const labelSize = kioskMode ? '17px' : '15px'
  const rowGap = kioskMode ? 12 : 8

  return (
    <div style={{
      minHeight: '100svh', display: 'flex', flexDirection: 'column',
      background: GE.paper, fontFamily: 'var(--font-sans)',
    }}>
      {/* ── 上部カラーバー ─────────────────────────────────────────────── */}
      <div style={{ height: kioskMode ? 6 : 4, background: `linear-gradient(90deg, ${GE.inkDark} 0%, ${GE.ink} 50%, ${GE.success} 100%)` }} />

      {/* ── ヘッダー ───────────────────────────────────────────────────── */}
      <header style={{
        background: '#fff', borderBottom: `1px solid ${GE.border}`,
        padding: kioskMode ? '24px 28px' : '16px 20px', textAlign: 'center',
      }}>
        <p style={{ font: `500 10px/1 var(--font-mono)`, letterSpacing: '0.16em', textTransform: 'uppercase', color: GE.subtle, marginBottom: 6 }}>
          Genesis Edge · Reception
        </p>
        <h1 style={{ font: `700 ${headingSize}/1.2 var(--font-sans)`, color: GE.inkDark, margin: 0 }}>
          {storeName}
        </h1>
        <p style={{ font: `400 ${subSize}/1.4 var(--font-sans)`, color: GE.neutral, marginTop: 4 }}>
          {areaName}
        </p>
        {kioskMode && (
          <p style={{ font: `500 11px/1 var(--font-mono)`, letterSpacing: '0.1em', color: GE.subtle, marginTop: 8, textTransform: 'uppercase' }}>
            🖥️ Kiosk Mode
          </p>
        )}
      </header>

      {/* ── コンテンツ ─────────────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        padding: `${pad}px ${pad}px 20px`,
        display: 'flex', flexDirection: 'column', gap: rowGap,
        // タブレット: 中央寄せ + 最大幅
        maxWidth: kioskMode ? 560 : undefined,
        margin: kioskMode ? '0 auto' : undefined,
        width: kioskMode ? '100%' : undefined,
      }}>

        {/* ━━━ 入室セクション ━━━ */}
        <SectionHeader
          icon={<EnterIcon size={16} color="#fff" />}
          label={ja('入室', 'Check In', '入场', '입실')}
          sub={ja('入室方法を選択してください', 'Select check-in method', '请选择入场方式', '입실 방법을 선택하세요')}
          accentColor={GE.ink}
          softColor={GE.soft}
          lineColor={GE.line}
        />

        <OptionRow
          href={`/r/${token}/face-auth?mode=checkin`}
          icon={<FaceIcon size={kioskMode ? 32 : 26} color="#fff" />}
          label={ja('顔認証でチェックイン', 'Face ID Check-In', '刷脸入场', '얼굴 인식으로 입실')}
          sub={ja('登録済みの方はすぐに入室できます', 'Instant entry for registered visitors', '已注册用户可立即入场', '등록된 분은 바로 입실 가능합니다')}
          tag={ja('推奨', 'REC', '推荐', '추천')}
          variant="primary"
          cfg={inPrimary}
          kiosk={kioskMode}
        />

        <OptionRow
          href={`/r/${token}/scan?mode=checkin`}
          icon={<QrIcon size={kioskMode ? 30 : 24} color={GE.ink} />}
          label={ja('QRコードで入室', 'QR Code Check-In', '扫码入场', 'QR 코드로 입실')}
          sub={ja('メールで届いたQRコードをスキャン', 'Scan the QR code from your email', '扫描邮件中的二维码', '이메일로 받은 QR 코드를 스캔하세요')}
          tag="QR"
          variant="secondary"
          cfg={inSecondary}
          kiosk={kioskMode}
        />

        <OptionRow
          href={`/r/${token}/consent`}
          icon={<NewIcon size={kioskMode ? 30 : 24} color={GE.neutral} />}
          label={ja('はじめての方', 'New Visitor', '初次访客', '처음 방문하시는 분')}
          sub={ja('フォームに情報を入力して入室', 'Fill in the form to check in', '填写表格入场', '양식을 작성하여 입실')}
          variant="ghost"
          cfg={inGhost}
          kiosk={kioskMode}
        />

        {/* 顔認証初回登録リンク */}
        <a
          href={`/r/${token}/consent`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 14px',
            color: GE.subtle,
            font: `400 11px/1 var(--font-sans)`,
            textDecoration: 'none',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          {ja('顔認証を初めて登録する方 →', 'Register face auth for first time →', '首次注册人脸识别 →', '처음 얼굴 인증 등록하기 →')}
        </a>

        {/* ─── 区切り ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
          <div style={{ flex: 1, height: 1, background: GE.border }} />
          <span style={{ font: `500 10px/1 var(--font-mono)`, letterSpacing: '0.1em', color: GE.subtle }}>
            ·  ·  ·
          </span>
          <div style={{ flex: 1, height: 1, background: GE.border }} />
        </div>

        {/* ━━━ 退室セクション ━━━ */}
        <SectionHeader
          icon={<ExitIcon size={16} color="#fff" />}
          label={ja('退室', 'Check Out', '离场', '퇴실')}
          sub={ja('退室方法を選択してください', 'Select check-out method', '请选择离场方式', '퇴실 방법을 선택하세요')}
          accentColor={GE.success}
          softColor={GE.successSoft}
          lineColor={GE.successLine}
        />

        <OptionRow
          href={`/r/${token}/face-auth?mode=checkout`}
          icon={<FaceIcon size={kioskMode ? 32 : 26} color="#fff" />}
          label={ja('顔認証で退室', 'Face ID Check-Out', '刷脸离场', '얼굴 인식으로 퇴실')}
          sub={ja('カメラで顔をスキャンして退室', 'Scan your face to check out', '扫描人脸离场', '카메라로 얼굴을 스캔하여 퇴실')}
          tag={ja('推奨', 'REC', '推荐', '추천')}
          variant="primary"
          cfg={outPrimary}
          kiosk={kioskMode}
        />

        <OptionRow
          href={`/r/${token}/scan?mode=checkout`}
          icon={<QrIcon size={kioskMode ? 30 : 24} color={GE.success} />}
          label={ja('QRコードで退室', 'QR Code Check-Out', '扫码离场', 'QR 코드로 퇴실')}
          sub={ja('入室時のQRコードをスキャン', 'Scan your check-in QR code', '扫描入场时的二维码', '입실 시 QR 코드를 스캔하세요')}
          tag="QR"
          variant="secondary"
          cfg={outSecondary}
          kiosk={kioskMode}
        />

      </main>

      {/* ── フッター ───────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: `1px solid ${GE.border}`,
        padding: '10px 20px', background: '#fff', textAlign: 'center',
      }}>
        <span style={{
          font: `500 9px/1 var(--font-mono)`,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: GE.subtle,
        }}>
          Genesis Edge · Reception
        </span>
      </footer>
    </div>
  )
}
