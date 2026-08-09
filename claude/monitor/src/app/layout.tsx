import './globals.css'
// Genesis Edge デザインシステムのフォント（self-host=@fontsource・ビルド堅牢）。
// 本文 Noto Sans JP / 欧文見出し Inter Tight / 数字・コード IBM Plex Mono。
//
// 日本語フォントは 1 ウェイトあたり @font-face 124 件に分割されている（unicode-range
// 単位）。**これは意図した形で、まとめてはいけない**。ブラウザは実際に使う字が入った
// 塊だけを取りに行くため、実測で 61 ファイル ≒ 760 KB に収まる。fontsource の
// 一体版（japanese-400.css）に替えると 1 ウェイト 994 KB × 3 ≒ 3 MB を必ず全部
// 落とすことになり、4 倍悪化する。`font-display: swap` 済みで描画はブロックしない。
//
// 章扉用の Noto Serif JP は**どこからも参照されていなかった**ため 2026-08-09 に削除。
// 生 107 KB（brotli 18 KB）・@font-face 124 件がまるごと無駄になっていた。依存も外して
// あるので、再び使うときは `bun add @fontsource/noto-serif-jp` からやり直し、globals.css
// の --font-ge-serif / --ge-font-serif（今は端末標準の明朝）とセットで戻すこと。
import '@fontsource/noto-sans-jp/400.css'
import '@fontsource/noto-sans-jp/500.css'
import '@fontsource/noto-sans-jp/700.css'
import '@fontsource/inter-tight/500.css'
import '@fontsource/inter-tight/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { SwRegister } from '@/components/SwRegister'
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { LangProvider } from '@/lib/i18n/context'
import { getLang } from '@/lib/i18n/server'

export const metadata: Metadata = {
  title: {
    template: '%s | Intereco Monitor',
    default:  'Intereco Monitor',
  },
  description: 'i-PRO / Uniview レコーダ統合監視システム',
  applicationName: 'Intereco Monitor',
  appleWebApp: {
    capable: true,
    title: 'Intereco Monitor',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      // iPhone ホーム画面アイコン（180px が iOS 標準）
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#0F0F10',
}

// Anti-FOUC: apply the saved theme (light/dark/auto) before first paint.
// auto = dark between 18:00 and 06:00. Mirrors ThemeToggle logic.
const THEME_INIT = `(function(){try{
  var m = localStorage.getItem('app-theme') || 'auto';
  var h = new Date().getHours();
  var dark = m === 'dark' || (m === 'auto' && (h >= 18 || h < 6));
  if (dark) document.documentElement.classList.add('dark');
}catch(e){}})();`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve language from `intereco-lang` cookie so server components and the
  // initial client paint are consistent (no JP→user-lang flicker on first load).
  const lang = await getLang()
  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 antialiased dark:bg-gedbg dark:text-gedink">
        {/* F72: Anti-FOUC theme init. Uses next/script with beforeInteractive
            so the script runs before React hydrates (avoiding the React 19
            warning about <script> tags rendered inside components). */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
        <LangProvider initialLang={lang}>
          <OfflineIndicator />
          {children}
          <PwaInstallPrompt />
        </LangProvider>
        <SwRegister />
      </body>
    </html>
  )
}
