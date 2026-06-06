/**
 * F46.4: PendingCommand 関連型
 *
 * Supabase pending_commands テーブルと対応。両 app で同じ enum / 型を使う。
 */

/** pending_commands.status 取りうる値 */
export type PendingCommandStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** pending_commands.command (実行コマンド名) */
export type PendingCommandName =
  | 'capture_snapshot'
  | 'start_live'
  | 'stop_live'
  | 'start_grid'
  | 'stop_grid'
  | 'export_vod'
  | 'start_bcp_capture'
  | 'test_nvr_connection'
  | 'patrol_capture'

/** pending_commands テーブル行 (簡略) */
export interface PendingCommandRow {
  id:          string
  store_id:    string | null
  command:     PendingCommandName
  payload:     Record<string, unknown> | null
  status:      PendingCommandStatus
  claimed_by:  string | null
  claimed_at:  string | null
  result:      Record<string, unknown> | null
  error:       string | null
  created_at:  string
  updated_at:  string
}
