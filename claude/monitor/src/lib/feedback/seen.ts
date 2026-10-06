/**
 * テナント管理者の左メニューの「要望」に出す件数の印（基本設計 §3.6）。
 *
 * 件数 = 自分のテナントの要望のうち、送った要望の一覧（/settings/feedback）を
 * 最後に開いた時刻（feedback_seen.seen_at）より後に、運営が状態・返事・対応の版を
 * 変えたもの。feedback_items.updated_at はその 3 つが変わったときだけ進む（DB のトリガ）。
 *
 * 送ったばかりで運営がまだ触っていない要望（received・返事なし・版なし）は数えない
 * （自分で送ったものに印が付くと「返事が来た」と読み違えるため）。
 *
 * 一覧を開いた時刻は利用者ごとに持つ（テナント管理者が複数いても、ひとりが開いただけで
 * 他の管理者の印は消えない）。一度も開いていない利用者は、運営が触った要望をすべて数える。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SeenRow {
  status: string
  reply: string | null
  fixed_version: string | null
  updated_at: string
}

/** 運営が状態・返事・対応の版のどれかを付けたか（送ったままの要望は false）。 */
export function operatorTouched(r: Pick<SeenRow, 'status' | 'reply' | 'fixed_version'>): boolean {
  return r.status !== 'received' || r.reply != null || r.fixed_version != null
}

/** 一覧の 1 件が「前に開いたあとに変わった（新しい返事・状態）」か。 */
export function isUnseenUpdate(r: SeenRow, seenAt: string | null): boolean {
  if (!operatorTouched(r)) return false
  return seenAt == null || Date.parse(r.updated_at) > Date.parse(seenAt)
}

/** PostgREST の or 条件（operatorTouched と同じ意味） */
const TOUCHED_OR = 'status.neq.received,reply.not.is.null,fixed_version.not.is.null'

/** 一覧を最後に開いた時刻（無ければ null）。RLS 配下のセッションで読む（自分の行だけ見える）。 */
export async function loadSeenAt(supa: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supa
    .from('feedback_seen')
    .select('seen_at')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { seen_at: string }).seen_at
}

/**
 * 印の件数。読めないとき（表が未適用など）は null（印を出さない側へ倒す）。
 * RLS 配下のセッションで数える（テナント管理者は自分のテナントの要望しか見えない）。
 */
export async function countUnseenFeedback(
  supa: SupabaseClient,
  me: { userId: string; tenantId: string },
): Promise<number | null> {
  try {
    const seenAt = await loadSeenAt(supa, me.userId)
    let q = supa
      .from('feedback_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', me.tenantId)
      .or(TOUCHED_OR)
    if (seenAt) q = q.gt('updated_at', seenAt)
    const { count, error } = await q
    return error ? null : (count ?? 0)
  } catch {
    return null
  }
}

/**
 * 一覧を開いた時刻を記録する（既読にする）。書くのは service role（利用者の書き込み
 * ポリシーは置かない）。失敗しても一覧の表示は止めない（印が残るだけ）。
 */
export async function markFeedbackSeen(
  svc: SupabaseClient,
  me: { userId: string; tenantId: string },
  now: Date = new Date(),
): Promise<boolean> {
  const { error } = await svc
    .from('feedback_seen')
    .upsert(
      { auth_user_id: me.userId, tenant_id: me.tenantId, seen_at: now.toISOString() },
      { onConflict: 'auth_user_id' },
    )
  if (error) console.warn('[feedback] seen の記録に失敗:', error.message)
  return !error
}
