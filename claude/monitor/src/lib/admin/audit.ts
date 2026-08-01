/**
 * 管理操作の監査ログ記録（admin_audit_log）。
 *
 * - best-effort: 記録失敗で本処理(設定変更)を失敗させない（warn ログのみ）。
 * - 秘密(パスワード等)は呼び出し側で changes に入れない／マスクすること。
 * - RLS: actor_user_id = auth.uid() の行のみ INSERT 可（guard.supa=セッションクライアントで呼ぶ）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditEntry {
  actorUserId: string
  action:      string                 // 'recorder.update' / 'edge.update' / 'enrollment.issue' など
  targetType:  'recorder' | 'recorder_cameras' | 'edge' | 'enrollment' | 'inspection_settings' | 'employee' | 'tenant' | 'store'
             | 'user' | 'nvr_model' | 'session_limit' | 'bcp_settings'
  targetId:    string | null
  storeId:     string | null          // RLS スコープ用
  changes?:    Record<string, unknown>
}

export async function recordAudit(supa: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await supa.from('admin_audit_log').insert({
    actor_user_id: e.actorUserId,
    action:        e.action,
    target_type:   e.targetType,
    target_id:     e.targetId,
    store_id:      e.storeId,
    changes:       e.changes ?? null,
  })
  if (error) console.warn('[audit] insert failed:', error.message)
}

/** recorder_id → 所属店舗 id（監査の store スコープ用）。失敗時 null。 */
export async function storeIdForRecorder(supa: SupabaseClient, recorderId: string): Promise<string | null> {
  const { data } = await supa
    .from('recorders')
    .select('edge_devices ( store_id )')
    .eq('id', recorderId)
    .single()
  // to-one リレーションは object だが、型上 array になる場合もあるため両対応。
  const rel = (data as { edge_devices?: unknown } | null)?.edge_devices
  const edge = (Array.isArray(rel) ? rel[0] : rel) as { store_id?: string | null } | undefined
  return edge?.store_id ?? null
}

/** edge_id → 所属店舗 id。失敗時 null。 */
export async function storeIdForEdge(supa: SupabaseClient, edgeId: string): Promise<string | null> {
  const { data } = await supa.from('edge_devices').select('store_id').eq('id', edgeId).single()
  return (data as { store_id?: string | null } | null)?.store_id ?? null
}
