'use client'

/**
 * /offline — 圏外のときに Service Worker が出す画面 (public/sw-v2.js)。
 *
 * 2026-10-29 (自主診断 ASVS 14.3.1・14.3.3) から、SW は認証済みの画面を控えない。圏外で画面を
 * 開き直すと、前に見た画面ではなくこの画面になる。URL は元の画面のままなので、接続が戻ったら
 * 再読み込みで元の画面へ戻る:
 *   - 画面の JS が動くとき: online のイベントと 10 秒ごとの疎通の確認 (/api/server-time)
 *   - JS が読めないとき: meta refresh (15 秒)
 * 手荷物検査のキオスク (/kiosk/) では、キオスクの圏外の表示と同じ案内を出す。
 */
import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function OfflinePage() {
  // サーバで描くときは分からない (URL は元の画面のまま SW が返す) ので、画面の側で決める
  const kiosk = useSyncExternalStore(noopSubscribe, isKioskPath, () => false)

  useEffect(() => {
    const back = () => window.location.reload()
    window.addEventListener('online', back)
    // ネットワークは生きていてサーバだけ届かなかったときは online が来ないので、疎通を見て戻る
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/server-time', { cache: 'no-store' })
        if (res.ok) back()
      } catch { /* まだ届かない */ }
    }, 10_000)
    return () => { window.removeEventListener('online', back); clearInterval(t) }
  }, [])

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-ge-paper px-4 text-ge-ink dark:bg-gedbg dark:text-gedink">
      <meta httpEquiv="refresh" content="15" />
      {!kiosk && <div className="absolute right-4 top-4"><ThemeToggle /></div>}
      <WifiOff className="h-12 w-12 text-ge-ink-3 dark:text-gedink2" strokeWidth={1.5} aria-hidden="true" />
      {kiosk ? (
        <>
          <h1 className="text-[32px] font-bold">係員をお呼びください</h1>
          <p className="text-center text-[16px] text-ge-ink-2 dark:text-gedink2">
            ただいま受付システムに接続できません。復旧すると自動で戻ります。
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[24px] font-bold">オフライン</h1>
          <p className="text-center text-[14px] leading-relaxed text-ge-ink-2 dark:text-gedink2">
            ネットワークに接続できません。<br />
            接続が戻ると、自動で元の画面に戻ります。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-[4px] bg-ge-accent px-6 py-2.5 text-[14px] font-medium text-white hover:bg-ge-ink-2 dark:bg-gedaccent dark:text-gedbg"
          >
            再試行
          </button>
        </>
      )}
    </main>
  )
}

function noopSubscribe(): () => void {
  return () => {}
}

function isKioskPath(): boolean {
  return window.location.pathname.startsWith('/kiosk/')
}
