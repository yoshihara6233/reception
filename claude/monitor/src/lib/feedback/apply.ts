import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { groupChanges, type ItemChange, type ItemSnapshot } from './cascade'

/**
 * 要望ボードの変更を DB へ書く（service role）。変更は必ず feedback_events に残す。
 * 運営アクセスログ（admin_audit_log）への記録は呼び出し側（recordAudit）で行う。
 */

export interface FeedbackEventRow {
  item_id?: string | null
  topic_id?: string | null
  actor_user_id: string
  action: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export async function recordFeedbackEvents(svc: SupabaseClient, rows: FeedbackEventRow[]): Promise<boolean> {
  if (rows.length === 0) return true
  const { error } = await svc.from('feedback_events').insert(rows.map((r) => ({
    item_id: r.item_id ?? null,
    topic_id: r.topic_id ?? null,
    actor_user_id: r.actor_user_id,
    action: r.action,
    before: r.before ?? null,
    after: r.after ?? null,
  })))
  if (error) console.warn('[feedback] events insert failed:', error.message)
  return !error
}

/** 要望の状態・返事・対応の版の変更を、同じ値へ変えるものごとにまとめて書く。 */
export async function applyItemChanges(svc: SupabaseClient, changes: ItemChange[]): Promise<boolean> {
  for (const g of groupChanges(changes)) {
    const { error } = await svc.from('feedback_items').update(g.after).in('id', g.ids)
    if (error) {
      console.warn('[feedback] items update failed:', error.message)
      return false
    }
  }
  return true
}

/** 状態の写しに要る列 */
export const SNAPSHOT_COLUMNS = 'id, status, reply, fixed_version, topic_id, store_id, tenant_id'

export interface ItemRow extends ItemSnapshot {
  topic_id: string | null
  store_id: string | null
  tenant_id: string
}
