'use client'

import { useEffect } from 'react'

// global-error replaces the root layout on fatal errors — must include <html> and <body>
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Production: replace with proper error logging (Sentry, etc.)
    console.error('[global-error]', error)
  }, [error])

  return (
    <html lang="ja">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f9fafb',
            padding: '1rem',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
            <p style={{ fontSize: '3.75rem', fontWeight: 700, color: '#d1d5db' }}>500</p>
            <h1 style={{ marginTop: '1rem', fontSize: '1.5rem', fontWeight: 600, color: '#1f2937' }}>
              重大なエラーが発生しました
            </h1>
            <p style={{ marginTop: '0.5rem', color: '#6b7280' }}>
              アプリケーションで問題が発生しました。再読み込みをお試しください。
            </p>
            {error.digest && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                エラーID: {error.digest}
              </p>
            )}
            <div style={{ marginTop: '2rem' }}>
              <button
                onClick={reset}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.625rem 1.25rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                もう一度試す
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
