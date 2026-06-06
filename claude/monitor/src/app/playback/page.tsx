import { redirect } from 'next/navigation'

/**
 * /playback → /stores へリダイレクト。
 * 録画再生は店舗の監視画面（/stores/[id]）内で行うため、独立ページは廃止。
 */
export default function PlaybackPage() {
  redirect('/stores')
}
