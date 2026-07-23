'use client'

/**
 * 単独詳細ページ用: プレイヤー＋「確認済み」ボタンをまとめ、再生完了で解禁する。
 * master-detail 右ペイン（SessionDetailPane）と同じゲート規律を単独ページにも適用
 * （従来この画面はゲート無しで確認できてしまう抜け道だった）。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SessionPlayer, type PlayerClip } from './SessionPlayer'
import { ConfirmButton } from './ConfirmButton'
import { RetryClipsButton } from '../RetryClipsButton'

export function SessionReview(
  { sessionId, confirmed, clips, windowLabel, clipsPending, clipTotal, clipDone }:
  {
    sessionId: string; confirmed: boolean; clips: PlayerClip[]; windowLabel: string
    clipsPending: boolean; clipTotal: number; clipDone: number
  },
) {
  const router = useRouter()
  const [reviewed, setReviewed] = useState(false)
  return (
    <div className="space-y-3">
      <SessionPlayer
        clips={clips}
        windowLabel={windowLabel}
        clipsPending={clipsPending}
        onReviewed={() => setReviewed(true)}
      />
      <div className="flex items-center justify-between gap-3">
        <RetryClipsButton sessionId={sessionId} clipTotal={clipTotal} clipDone={clipDone} onRequeued={() => router.refresh()} />
        <ConfirmButton sessionId={sessionId} confirmed={confirmed} disabled={!reviewed} />
      </div>
    </div>
  )
}
