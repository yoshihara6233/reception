'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import type { Lang } from '@/lib/i18n/messages'

/**
 * 「アプリとして使う（ホーム画面に追加）」導線。
 *
 * PWA の足場（manifest / sw-v2.js）は揃っているが、ブラウザは iOS で自動の
 * インストールプロンプトを出せないため、案内が無いとオペレータが全画面アプリ化に
 * 気づけない。これがその欠けていた導線。
 *
 *  - Android/Chrome/Edge: `beforeinstallprompt` を捕捉してワンタップ追加
 *  - iOS Safari:          手動手順（共有 → ホーム画面に追加）を案内
 *  - 既にスタンドアロン起動中 / 一度閉じた場合は表示しない
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed'

const STRINGS: Record<Lang, { title: string; desc: string; install: string; iosHint: string; dismiss: string }> = {
  ja: { title: 'アプリとして使う', desc: 'ホーム画面に追加すると全画面で素早く開けます', install: 'ホーム画面に追加', iosHint: '共有ボタン → 「ホーム画面に追加」を選択', dismiss: '閉じる' },
  en: { title: 'Use as an app',   desc: 'Add to your home screen for full-screen quick access', install: 'Add to Home Screen', iosHint: 'Share button → "Add to Home Screen"', dismiss: 'Dismiss' },
  zh: { title: '作为应用使用',     desc: '添加到主屏幕即可全屏快速打开', install: '添加到主屏幕', iosHint: '分享按钮 →「添加到主屏幕」', dismiss: '关闭' },
  ko: { title: '앱으로 사용',      desc: '홈 화면에 추가하면 전체 화면으로 빠르게 열 수 있습니다', install: '홈 화면에 추가', iosHint: '공유 버튼 → "홈 화면에 추가"', dismiss: '닫기' },
}

export function PwaInstallPrompt() {
  const { lang } = useLang()
  const s = STRINGS[lang] ?? STRINGS.ja

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Already installed (running standalone) → never prompt.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) return

    // User dismissed before → respect it.
    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1' } catch { /* ignore */ }
    if (dismissed) return

    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    setIsIOS(ios)

    // iOS Safari has no beforeinstallprompt — show the manual hint directly.
    if (ios) setShow(true)

    // Android/Chromium — capture the install event and show a one-tap button.
    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // If it gets installed, hide.
    function onInstalled() { setShow(false) }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    try { await deferred.userChoice } catch { /* ignore */ }
    setDeferred(null)
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-96.png" alt="" className="h-10 w-10 flex-shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{s.title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {isIOS && !deferred ? s.iosHint : s.desc}
          </p>
        </div>
        {deferred ? (
          <button
            type="button"
            onClick={install}
            className="flex-shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 active:bg-blue-800"
          >
            {s.install}
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label={s.dismiss}
          title={s.dismiss}
          className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
