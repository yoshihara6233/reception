'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Production: replace with proper error logging (Sentry, etc.)
    console.error('[app-error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-gray-300">500</p>
        <h1 className="mt-4 text-2xl font-semibold text-gray-800">
          エラーが発生しました
        </h1>
        <p className="mt-2 text-gray-500">
          予期しないエラーが発生しました。しばらくしてから再度お試しください。
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-gray-400 font-mono">
            エラーID: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            もう一度試す
          </button>
        </div>
      </div>
    </div>
  )
}
