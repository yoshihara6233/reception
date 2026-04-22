'use client'

import { useCallback, useEffect } from 'react'
import type { Locale } from '@/lib/i18n/useLocale'

const MUTE_KEY   = 'reception-speech-muted'
const LOCALE_KEY = 'reception-locale'
const VALID_LOCALES: Locale[] = ['ja', 'en', 'zh', 'ko']

// ─── アナウンス文言（Web Speech API フォールバック用） ────────────────────────

export const ANNOUNCEMENTS: Record<string, Record<Locale, string>> = {
  reception: {
    ja: 'ご来訪ありがとうございます。入室の方は入室ボタン、退室の方は退室ボタンをタップしてください。',
    en: 'Welcome. Please tap Check In to enter, or Check Out to leave.',
    zh: '欢迎光临。请点击入室按钮进入，或点击退室按钮离开。',
    ko: '방문해 주셔서 감사합니다. 입실하시려면 입실 버튼을, 퇴실하시려면 퇴실 버튼을 탭하세요.',
  },
  card: {
    ja: '名刺を枠内に収めて、撮影ボタンを押してください。',
    en: 'Please place your business card within the frame, then tap the capture button.',
    zh: '请将名片放入框内，然后按下拍摄按钮。',
    ko: '명함을 프레임 안에 맞추고 촬영 버튼을 눌러주세요.',
  },
  register: {
    ja: 'お名前と会社名、来訪目的を入力してください。',
    en: 'Please enter your name, company, and the purpose of your visit.',
    zh: '请输入您的姓名、公司名称和来访目的。',
    ko: '성함과 회사명, 방문 목적을 입력해 주세요.',
  },
  'register-ocr': {
    ja: '名刺の情報を自動入力しました。内容をご確認ください。',
    en: 'Business card details have been filled in automatically. Please review and confirm.',
    zh: '名片信息已自动填写。请确认信息是否正确。',
    ko: '명함 정보가 자동으로 입력되었습니다. 내용을 확인해 주세요.',
  },
  face: {
    ja: 'カメラに顔を向けて、撮影ボタンを押してください。',
    en: 'Please face the camera and tap the capture button.',
    zh: '请面对摄像头，然后按下拍摄按钮。',
    ko: '카메라를 바라보고 촬영 버튼을 눌러주세요.',
  },
  baggage: {
    ja: '手荷物を申告してください。カバンの中身とカバン内部の写真を撮影します。',
    en: 'Please declare your baggage. You will photograph its contents and the inside of the bag.',
    zh: '请申报随身行李。请拍摄行李内容物及行李内部的照片。',
    ko: '수하물을 신고해 주세요. 가방 내용물과 가방 내부 사진을 촬영합니다.',
  },
  confirm: {
    ja: '入力内容をご確認ください。よろしければ入室するボタンを押してください。',
    en: 'Please review your information. When ready, tap the Check In button.',
    zh: '请确认您的信息。确认无误后，请点击入室按钮。',
    ko: '입력 내용을 확인해 주세요. 이상이 없으면 입실 버튼을 눌러주세요.',
  },
  done: {
    ja: '入室手続きが完了しました。ありがとうございます。',
    en: 'Check-in is complete. Thank you for visiting.',
    zh: '入室手续已完成。感谢您的到来。',
    ko: '입실 절차가 완료되었습니다. 감사합니다.',
  },
  checkout: {
    ja: '退室する場合は退室するボタンを押してください。',
    en: 'Please tap the Check Out button to complete your check-out.',
    zh: '请点击退室按钮完成退出登记。',
    ko: '퇴실 버튼을 눌러 퇴실 절차를 완료해 주세요.',
  },
  'checkout-done': {
    ja: '退室手続きが完了しました。またのご来訪をお待ちしております。',
    en: 'Check-out is complete. Thank you, and we look forward to your next visit.',
    zh: '退室手续已完成。期待您的再次光临。',
    ko: '퇴실 절차가 완료되었습니다. 다음 방문을 기다리겠습니다.',
  },
}

// ─── 音声ファイル（事前録音 M4A） ────────────────────────────────────────────
// public/audio/{key}-{locale}.m4a として配置
// scripts/gen-audio.sh で macOS say コマンドから生成

const AUDIO_KEYS = Object.keys(ANNOUNCEMENTS)

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function getCurrentLocale(): Locale {
  if (typeof window === 'undefined') return 'ja'
  const s = localStorage.getItem(LOCALE_KEY) as Locale | null
  return s && VALID_LOCALES.includes(s) ? s : 'ja'
}
function getIsMuted(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(MUTE_KEY) === 'true'
}

// 再生中の Audio 要素（停止用）
let _currentAudio: HTMLAudioElement | null = null
// デバウンス用タイマー（React StrictMode の二重 useEffect 対策）
let _playTimer: ReturnType<typeof setTimeout> | null = null

// ─── 音声ファイル再生 ─────────────────────────────────────────────────────────

function playAudioFile(key: string, locale: Locale): boolean {
  const src = `/audio/${key}-${locale}.m4a`
  try {
    // 既存タイマーをキャンセル（StrictMode の1回目の呼び出しを無効化）
    if (_playTimer !== null) {
      clearTimeout(_playTimer)
      _playTimer = null
    }
    if (_currentAudio) {
      _currentAudio.pause()
      _currentAudio.currentTime = 0
      _currentAudio = null
    }
    const audio = new Audio(src)
    audio.onplay  = () => console.log(`[speech] ▶ ${src}`)
    audio.onended = () => { console.log(`[speech] ✓ ${src}`); if (_currentAudio === audio) _currentAudio = null }
    audio.onerror = () => {
      console.warn(`[speech] ✗ audio file not found: ${src}`)
      if (_currentAudio === audio) _currentAudio = null
      // フォールバック: Web Speech API（日本語のみ動作確認済み）
      fallbackSpeak(ANNOUNCEMENTS[key]?.[locale] ?? '', locale)
    }
    _currentAudio = audio
    // 50ms 遅延: StrictMode の cleanup → remount サイクルを吸収する
    _playTimer = setTimeout(() => {
      _playTimer = null
      if (_currentAudio !== audio) return  // cleanup で停止済みなら再生しない
      audio.play().catch(e => {
        console.warn(`[speech] play() rejected: ${e.message}`)
        fallbackSpeak(ANNOUNCEMENTS[key]?.[locale] ?? '', locale)
      })
    }, 50)
    return true
  } catch (e) {
    console.warn(`[speech] Audio init failed: ${e}`)
    return false
  }
}

// Web Speech API フォールバック（macOS Chrome で ja-JP のみ動作確認済み）
function fallbackSpeak(text: string, locale: Locale) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const langMap: Record<Locale, string> = { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN', ko: 'ko-KR' }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang  = langMap[locale] ?? 'ja-JP'
  utterance.rate  = 0.92
  // voice は指定しない（Chrome デフォルトが動作する）
  window.speechSynthesis.cancel()
  setTimeout(() => window.speechSynthesis.speak(utterance), 150)
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAnnounce() {
  const speak = useCallback((text: string, locale?: Locale) => {
    if (typeof window === 'undefined') return
    if (getIsMuted()) return
    const loc = locale ?? getCurrentLocale()
    fallbackSpeak(text, loc)
  }, [])

  const announce = useCallback((key: keyof typeof ANNOUNCEMENTS) => {
    if (typeof window === 'undefined') return
    if (getIsMuted()) return
    if (!AUDIO_KEYS.includes(key as string)) return
    const locale = getCurrentLocale()
    playAudioFile(key as string, locale)
  }, [])

  const stop = useCallback(() => {
    if (_playTimer !== null) { clearTimeout(_playTimer); _playTimer = null }
    if (_currentAudio) { _currentAudio.pause(); _currentAudio.currentTime = 0; _currentAudio = null }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const isMuted  = useCallback(() => getIsMuted(), [])
  const setMuted = useCallback((muted: boolean) => {
    localStorage.setItem(MUTE_KEY, String(muted))
    if (muted) {
      if (_currentAudio) { _currentAudio.pause(); _currentAudio = null }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  // ページ離脱時に停止（StrictMode の cleanup でも発火 → debounce タイマーをキャンセル）
  useEffect(() => {
    return () => {
      if (_playTimer !== null) { clearTimeout(_playTimer); _playTimer = null }
      if (_currentAudio) { _currentAudio.pause(); _currentAudio = null }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return { announce, speak, stop, isMuted, setMuted }
}
