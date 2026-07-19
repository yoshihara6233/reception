/**
 * 手荷物検査の状態バッジ辞書（M2 → M4 管理UIが参照・D7①）
 *
 * 藍(accent)は状態色に使わない（1画面2〜3要素の規律を守る・Genesis Edge）。
 * 状態色は墨の濃淡(muted)＋semantic 3色（緑/橙/赤）のみ。純データ＝UIから参照する。
 */

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

export interface BadgeDef {
  label: string
  tone: BadgeTone
  /** 一覧で複数該当時の表示優先度（小さいほど先頭）。 */
  priority: number
}

/** セッション状態（inspection_sessions.status）。 */
export const SESSION_STATUS: Record<string, BadgeDef> = {
  completed:        { label: '完了',        tone: 'ok',    priority: 50 },
  interrupted:      { label: '検査中断',    tone: 'warn',  priority: 20 },
  unmatched_entry:  { label: '入室記録なし', tone: 'bad',   priority: 10 },
  unmatched_exit:   { label: '退出なし',    tone: 'bad',   priority: 10 },
  entered:          { label: '入室中',      tone: 'muted', priority: 40 },
}

/** 直交フラグ（status とは別に併記）。 */
export const AUTH_SKIPPED_BADGE: BadgeDef = { label: '認証省略', tone: 'muted', priority: 60 }
export const UNCONFIRMED_BADGE:  BadgeDef = { label: '未確認',   tone: 'muted', priority: 30 }

/** クリップ表示状態（保存パイプライン・inspection_clips.upload_status から導出）。 */
export const CLIP_STATUS: Record<string, BadgeDef> = {
  processing:       { label: '処理中',       tone: 'accent', priority: 45 },
  partial:          { label: '一部のみ',     tone: 'warn',   priority: 25 },
  failed:           { label: '取得失敗',     tone: 'bad',    priority: 15 },
  expired:          { label: '保存期間終了', tone: 'muted',  priority: 70 },
  done:             { label: '2/2',          tone: 'ok',     priority: 55 },
}

export function sessionBadge(status: string): BadgeDef {
  return SESSION_STATUS[status] ?? { label: status, tone: 'muted', priority: 99 }
}

/**
 * クリップ2本の upload_status からクリップ表示状態を導く。
 *   0本 done → processing / 1本 → partial / 2本 → done。
 *   いずれか failed かつ未達 → failed。expired は保持purge後に別途付与。
 */
export function clipBadge(uploadStatuses: string[], expected = 2): BadgeDef {
  const done = uploadStatuses.filter((s) => s === 'done').length
  if (uploadStatuses.some((s) => s === 'failed') && done < expected) return CLIP_STATUS.failed
  if (done >= expected) return CLIP_STATUS.done
  if (done > 0) return CLIP_STATUS.partial
  return CLIP_STATUS.processing
}

/** 履歴一覧のフィルタキー → 述語ラベル（UIチップ）。 */
export const HISTORY_FILTERS = [
  { key: 'all',        label: 'すべて' },
  { key: 'completed',  label: '完了' },
  { key: 'unmatched',  label: 'アンマッチ' },
  { key: 'interrupted',label: '検査中断' },
  { key: 'auth_skipped',label: '認証省略' },
  { key: 'unconfirmed',label: '未確認' },
] as const

export type HistoryFilterKey = typeof HISTORY_FILTERS[number]['key']

/** フィルタキーを Supabase クエリ条件に落とすための記述（route が解釈）。 */
export function filterPredicate(key: HistoryFilterKey):
  | { kind: 'none' }
  | { kind: 'status'; values: string[] }
  | { kind: 'auth_skipped' }
  | { kind: 'unconfirmed' } {
  switch (key) {
    case 'completed':   return { kind: 'status', values: ['completed'] }
    case 'unmatched':   return { kind: 'status', values: ['unmatched_entry', 'unmatched_exit'] }
    case 'interrupted': return { kind: 'status', values: ['interrupted'] }
    case 'auth_skipped':return { kind: 'auth_skipped' }
    case 'unconfirmed': return { kind: 'unconfirmed' }
    case 'all':
    default:            return { kind: 'none' }
  }
}
