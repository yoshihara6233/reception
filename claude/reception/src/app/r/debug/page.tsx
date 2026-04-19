'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAnnounce } from '@/lib/speech/useAnnounce'
import type { Locale } from '@/lib/i18n/useLocale'

const LANG_CODE: Record<Locale, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
}

const TESTS = [
  { lang: 'ja-JP', label: '日本語', text: 'こんにちは。テストです。音声が出ていますか。' },
  { lang: 'en-US', label: 'English', text: 'Hello. This is a test. Can you hear this?' },
  { lang: 'zh-CN', label: '中文',    text: '你好。这是一个测试。你能听到吗？' },
  { lang: 'ko-KR', label: '한국어',  text: '안녕하세요. 이것은 테스트입니다. 들리나요?' },
]

export default function SpeechDebugPage() {
  const { speak, announce, isMuted, setMuted } = useAnnounce()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [localeDisplay, setLocaleDisplay] = useState('(読込中)')
  const [mutedState, setMutedState] = useState(false)
  const [testingVoice, setTestingVoice] = useState<string | null>(null)

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false })
    setLogs(prev => [`${ts} ${msg}`, ...prev].slice(0, 60))
  }, [])

  useEffect(() => {
    setLocaleDisplay(localStorage.getItem('reception-locale') || 'ja (未設定)')
    setMutedState(localStorage.getItem('reception-speech-muted') === 'true')

    const load = () => {
      const v = window.speechSynthesis.getVoices()
      setVoices(v)
      log(`voices: ${v.length}件ロード`)
    }
    load()
    window.speechSynthesis.onvoiceschanged = load
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [log])

  // ① 直接テスト（cancel → 150ms → speak）
  const testDirect = (lang: string, text: string) => {
    const ss = window.speechSynthesis
    log(`▶ 直接: ${lang} speaking=${ss.speaking} pending=${ss.pending}`)
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 0.92
    u.onstart = () => log(`✓ onstart: ${lang}`)
    u.onend   = () => log(`✓ onend: ${lang}`)
    u.onerror = (e) => log(`✗ onerror: ${lang} → ${e.error}`)
    ss.cancel()
    setTimeout(() => ss.speak(u), 150)
  }

  // ② hook テスト
  const testHook = (locale: Locale) => {
    log(`▶ hook: locale=${locale}`)
    localStorage.setItem('reception-locale', locale)
    setLocaleDisplay(locale)
    speak('This is a hook test.', locale)
  }

  // ③ 個別 voice テスト
  const testVoice = (voice: SpeechSynthesisVoice) => {
    setTestingVoice(voice.name)
    log(`▶ voice: "${voice.name}" (${voice.lang}) local=${voice.localService}`)
    const u = new SpeechSynthesisUtterance('Test. Can you hear this voice?')
    u.lang = voice.lang
    u.voice = voice
    u.rate = 0.92
    u.onstart = () => { log(`✓ "${voice.name}" 再生OK`); setTestingVoice(null) }
    u.onend   = () => { log(`✓ "${voice.name}" 完了`);   setTestingVoice(null) }
    u.onerror = (e) => { log(`✗ "${voice.name}" → ${e.error}`); setTestingVoice(null) }
    const ss2 = window.speechSynthesis
    ss2.cancel()
    setTimeout(() => ss2.speak(u), 150)
  }

  const testAnnounce = () => {
    log(`▶ announce(reception): locale=${localStorage.getItem('reception-locale')}`)
    announce('reception')
  }

  const toggleMute = () => {
    const next = !mutedState
    setMuted(next)
    setMutedState(next)
    log(`ミュート: ${next ? 'ON' : 'OFF'}`)
  }

  const enVoices = voices.filter(v => v.lang.toLowerCase().startsWith('en'))
  const jaVoices = voices.filter(v => v.lang.toLowerCase().startsWith('ja'))

  return (
    <div className="min-h-screen bg-gray-100 p-4 text-sm">
      <h1 className="text-lg font-bold mb-3">🔊 Speech Debug</h1>

      {/* Status */}
      <div className="bg-white rounded-xl p-4 mb-3 space-y-1">
        <p>📍 locale: <strong>{localeDisplay}</strong></p>
        <p>🔇 ミュート: <strong className={mutedState ? 'text-red-600' : 'text-green-600'}>{mutedState ? 'ON（消音中）' : 'OFF'}</strong></p>
        <p>🎙 voices: <strong>{voices.length}件</strong></p>
        <button onClick={toggleMute}
          className={`mt-2 px-4 py-2 rounded-lg text-white text-xs font-semibold ${mutedState ? 'bg-red-500' : 'bg-gray-500'}`}>
          {mutedState ? '🔇 ミュート解除' : '🔇 ミュートON'}
        </button>
      </div>

      {/* ① 直接テスト */}
      <div className="bg-white rounded-xl p-4 mb-3">
        <p className="font-semibold mb-1">① 直接テスト（resume()あり）</p>
        <div className="flex flex-wrap gap-2">
          {TESTS.map(({ lang, label, text }) => (
            <button key={lang} onClick={() => testDirect(lang, text)}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg font-medium">{label}</button>
          ))}
        </div>
      </div>

      {/* ② hook テスト */}
      <div className="bg-white rounded-xl p-4 mb-3">
        <p className="font-semibold mb-1">② useAnnounce hook</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {(['ja', 'en', 'zh', 'ko'] as Locale[]).map(l => (
            <button key={l} onClick={() => testHook(l)}
              className="px-3 py-2 bg-green-600 text-white rounded-lg font-medium">{l.toUpperCase()}</button>
          ))}
        </div>
        <button onClick={testAnnounce}
          className="px-3 py-2 bg-purple-600 text-white rounded-lg font-medium text-xs">
          announce(&#39;reception&#39;)
        </button>
      </div>

      {/* ③ 英語 voice 個別テスト */}
      <div className="bg-white rounded-xl p-4 mb-3">
        <p className="font-semibold mb-2">③ 英語 voice 個別テスト（{enVoices.length}件）</p>
        <p className="text-xs text-gray-400 mb-2">各 voice を個別に試す。✓ = localService</p>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {enVoices.map(v => (
            <button key={v.name}
              onClick={() => testVoice(v)}
              disabled={testingVoice === v.name}
              className={`w-full text-left px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                testingVoice === v.name ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200 hover:bg-blue-50'
              }`}>
              <span>
                <span className={v.localService ? 'text-green-600' : 'text-gray-400'}>{v.localService ? '✓' : '○'}</span>
                {' '}{v.name}
              </span>
              <span className="text-gray-400">{v.lang}</span>
            </button>
          ))}
          {enVoices.length === 0 && <p className="text-gray-400 text-xs">まだ読込中...</p>}
        </div>
      </div>

      {/* ④ 日本語 voice */}
      <div className="bg-white rounded-xl p-4 mb-3">
        <p className="font-semibold mb-2">④ 日本語 voice（{jaVoices.length}件）</p>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {jaVoices.map(v => (
            <button key={v.name}
              onClick={() => testVoice(v)}
              disabled={testingVoice === v.name}
              className="w-full text-left px-3 py-2 rounded-lg border text-xs bg-gray-50 border-gray-200 hover:bg-blue-50 flex items-center justify-between">
              <span>
                <span className={v.localService ? 'text-green-600' : 'text-gray-400'}>{v.localService ? '✓' : '○'}</span>
                {' '}{v.name}
              </span>
              <span className="text-gray-400">{v.lang}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Log */}
      <div className="bg-black rounded-xl p-3 font-mono text-xs text-green-400 h-48 overflow-y-auto">
        {logs.length === 0
          ? <p className="text-gray-500">上のボタンをタップしてください...</p>
          : logs.map((l, i) => <p key={i}>{l}</p>)}
      </div>
    </div>
  )
}
