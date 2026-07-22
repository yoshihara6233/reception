'use client'

/**
 * 単独詳細ページ用: プレイヤー＋「確認済み」ボタンをまとめ、再生完了で解禁する。
 * master-detail 右ペイン（SessionDetailPane）と同じゲート規律を単独ページにも適用
 * （従来この画面はゲート無しで確認できてしまう抜け道だった）。
 */
import { useState } from 'react'
import { SessionPlayer, type PlayerClip } from './SessionPlayer'
import { ConfirmButton } from './ConfirmButton'

export function SessionReview(
  { sessionId, confirmed, clips, windowLabel, clipsPending }:
  { sessionId: string; confirmed: boolean; clips: PlayerClip[]; windowLabel: string; clipsPending: boolean },
) {
  const [reviewed, setReviewed] = useState(false)
  return (
    <div className="space-y-3">
      <SessionPlayer
        clips={clips}
        windowLabel={windowLabel}
        clipsPending={clipsPending}
        onReviewed={() => setReviewed(true)}
      />
      <div className="flex justify-end">
        <ConfirmButton sessionId={sessionId} confirmed={confirmed} disabled={!reviewed} />
      </div>
    </div>
  )
}
