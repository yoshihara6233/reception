/**
 * Recorder Monitor ブランドマーク（モニター＋ステータスドット＋折れ角）。
 * アウトラインは currentColor（暗ヘッダーでは白）、アクセントは青。
 * ホーム画面アイコン(public/icons/monitor-icon.svg)と同じ意匠の UI 版。
 */
export function MonitorMark({ className, accent = '#2563eb' }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" aria-hidden="true">
      {/* モニター画面: 角丸＋右下が折れ角 */}
      <path
        d="M 80 72 L 432 72 Q 454 72 454 94 L 454 262 L 352 378 L 80 378 Q 58 378 58 356 L 58 94 Q 58 72 80 72 Z"
        stroke="currentColor" strokeWidth="32" strokeLinejoin="round"
      />
      {/* 折れ角(青) */}
      <path d="M 454 262 L 454 378 L 352 378 Z" fill={accent} />
      {/* ステータスドット(青) */}
      <circle cx="146" cy="150" r="33" fill={accent} />
      {/* スタンド */}
      <path d="M 256 378 L 256 432" stroke="currentColor" strokeWidth="32" strokeLinecap="round" />
      <path d="M 176 450 L 336 450" stroke="currentColor" strokeWidth="32" strokeLinecap="round" />
    </svg>
  )
}
