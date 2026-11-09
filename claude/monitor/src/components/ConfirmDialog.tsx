'use client'

/**
 * 確認の窓 (アプリ内)。ブラウザ標準の confirm() の置き換え。
 *
 * ブラウザ標準の確認の窓は、ブラウザや設定によっては出ずに「いいえ」扱いになり、
 * 削除などが黙って取り消される (2026-11-09 シナリオ試験 2 周目 6-14 で見つけた)。
 * そのため確認はすべてこの窓で行う。
 *
 * 使い方: `if (!(await askConfirm('削除しますか？', { confirmLabel: '削除', danger: true }))) return`
 * 呼ぶたびに body の下へ窓を作り、押されたら片付けて結果を返す。Provider は要らない。
 */
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

export interface ConfirmOptions {
  /** 見出し。既定は「確認」 */
  title?: string
  /** 実行するボタンの文言。既定は「OK」 */
  confirmLabel?: string
  /** 取り消しのボタンの文言。既定は「キャンセル」 */
  cancelLabel?: string
  /** 削除など元に戻せない操作なら true (実行のボタンを危険色にする) */
  danger?: boolean
}

export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    // 開く前に触っていた部品へ戻す (キーボードで操作している人のため)
    const prevFocus = document.activeElement as HTMLElement | null
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      root.unmount()
      host.remove()
      prevFocus?.focus?.()
      resolve(ok)
    }
    root.render(<ConfirmBox message={message} opts={opts} onDone={done} />)
  })
}

function ConfirmBox({ message, opts, onDone }: { message: string; opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // 元に戻せない操作は、Enter の押し間違いで進まないよう取り消しに焦点を置く
    ;(opts.danger ? cancelRef : okRef).current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDone(false) }
      // 焦点を窓の中に留める (2 つのボタンの間だけを行き来する)
      if (e.key === 'Tab') {
        const a = cancelRef.current, b = okRef.current
        if (!a || !b) return
        e.preventDefault()
        ;(document.activeElement === a ? b : a).focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [opts.danger, onDone])

  const btn = 'rounded px-3 py-1.5 text-xs font-medium'
  const btnSecondary = `${btn} border border-ge-line bg-white text-ge-ink-2 hover:bg-ge-paper-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink`
  const btnPrimary = opts.danger
    ? `${btn} bg-ge-danger text-white hover:opacity-90`
    : `${btn} bg-ge-accent text-white hover:bg-ge-ink-2 dark:bg-gedaccent dark:text-gedbg`

  // 重なり順は地図 (Leaflet の部品は 400〜1000) と要望の窓 (1100) より上にする
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ge-ink/50 p-3 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false) }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ge-confirm-title"
        aria-describedby="ge-confirm-message"
        className="w-full max-w-md rounded-[10px] border border-ge-line bg-white text-ge-ink shadow-xl dark:border-gedline dark:bg-gedbg2 dark:text-gedink"
      >
        <div className="border-b border-ge-line px-5 py-3 dark:border-gedline">
          <h2 id="ge-confirm-title" className="text-sm font-bold">{opts.title ?? '確認'}</h2>
        </div>
        <p id="ge-confirm-message" className="whitespace-pre-line px-5 py-4 text-[13px] leading-relaxed">
          {message}
        </p>
        <div className="flex justify-end gap-2 border-t border-ge-line px-5 py-3 dark:border-gedline">
          <button ref={cancelRef} type="button" className={btnSecondary} onClick={() => onDone(false)}>
            {opts.cancelLabel ?? 'キャンセル'}
          </button>
          <button ref={okRef} type="button" className={btnPrimary} onClick={() => onDone(true)}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
