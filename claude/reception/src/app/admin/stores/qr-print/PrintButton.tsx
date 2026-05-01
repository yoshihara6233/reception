'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print-hide px-8 py-3 bg-[var(--ge-accent)] text-white rounded-xl font-semibold text-sm hover:bg-[var(--ge-accent-ink)] transition-colors"
    >
      印刷する
    </button>
  )
}
