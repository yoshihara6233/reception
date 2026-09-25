/**
 * 視聴セッション（/api/sessions・live_sessions）の開始と終了を、取りこぼさずに行う部品。
 *
 * 同時視聴の上限（start_live_session）は「終了の記録が無いライブ・録画再生」を
 * 開始から 6 時間まで数える。終了を送り損ねると、閉じた画面がその間ずっと枠を使い、
 * 上限に届いて誰も見られなくなる（2026-09-25 本番で発生: 試験で開き直した 5 件が残り、
 * 上限 5 で「同時視聴の上限に達しました」）。取りこぼしは 2 通りあった:
 *
 *  1. 開始の応答が返る前に画面を離れた（モードの切り替え・すぐ戻る）。サーバでは
 *     セッションができているのに、画面は「閉じた」として id を捨てていた
 *     → acceptStartedSession が、離れた後に届いた id をその場で終わらせる
 *  2. タブを閉じた・再読み込みした。React の後始末が走らない
 *     → endOnPageHide で pagehide でも終わらせる
 */

/** 開始の応答の本文（/api/sessions action=start）。 */
export interface StartedSession {
  id: string
  maxSessionMin?: number | null
}

/** 終了を送る。ページを離れる途中でも届くよう keepalive で送る。 */
export function endViewingSession(id: string): void {
  void fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'end', id }),
    keepalive: true,
  }).catch(() => {})
}

/**
 * 開始の応答からセッションを受け取る。応答が失敗なら null。
 * **画面がもう閉じていたら（cancelled）、できたセッションをその場で終わらせて null を返す。**
 */
export async function acceptStartedSession(res: Response, cancelled: () => boolean): Promise<StartedSession | null> {
  if (!res.ok) return null
  const j = await res.json().catch(() => null) as StartedSession | null
  if (!j?.id) return null
  if (cancelled()) {
    endViewingSession(j.id)
    return null
  }
  return j
}

/**
 * タブを閉じた・再読み込みしたときも end を呼ぶ（React の後始末は走らないため）。
 * 解除する関数を返す — 効果の後始末で必ず呼ぶ。
 */
export function endOnPageHide(end: () => void): () => void {
  window.addEventListener('pagehide', end)
  return () => window.removeEventListener('pagehide', end)
}
