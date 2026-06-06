'use client'

import { ThemeToggle } from '@/components/ThemeToggle'

export default function OfflinePage() {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-slate-100">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 p-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 6s2.5-3 11-3 11 3 11 3"/>
          <path d="M5 10s1.5-2 7-2 7 2 7 2"/>
          <line x1="2" y1="2" x2="22" y2="22"/>
        </svg>
      </div>
      <h1 className="text-2xl font-bold">オフライン</h1>
      <p className="text-center text-sm text-slate-400">
        ネットワーク接続がありません。<br />
        接続が回復したら自動的に再開します。
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
      >
        再試行
      </button>
    </div>
  )
}
