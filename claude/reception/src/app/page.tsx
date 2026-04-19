import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-8">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Reception Kiosk
        </h1>
        <p className="text-gray-400 mb-8">
          リテール店舗バックヤード向けセルフ受付システム
        </p>

        <div className="space-y-4">
          <Link
            href="/admin/dashboard"
            className="block w-full py-3 bg-gray-900 text-white rounded-xl text-center font-medium"
          >
            管理画面
          </Link>
          <Link
            href="/r/demo-qr-token-abc123"
            className="block w-full py-3 border-2 border-gray-200 text-gray-700 rounded-xl text-center font-medium"
          >
            デモ受付ページ
          </Link>
        </div>

        <p className="text-xs text-gray-300 mt-12">
          v0.1.0 — STEP1 MVP
        </p>
      </div>
    </div>
  )
}
