/**
 * F46.9: DB 型 (暫定手書き版)
 *
 * 本来は `./scripts/gen-db-types.sh` で Supabase から自動生成する。
 * Supabase 接続が無い環境でも型チェックが通るように、Tier 3 関連の新規スキーマ
 * (F46.6/F46.7/F46.8 で追加) を手書きで暫定提供する。
 *
 * 接続環境で `./scripts/gen-db-types.sh` を実行するとこのファイルは上書きされる。
 *
 * カバー範囲:
 *   - stores テーブルの新規カラム (deployment_mode / nvr_* / central_node_id)
 *   - central_nodes テーブル
 *   - nvr_models テーブル
 *   - v_store_nvr_lifecycle VIEW
 */
import type {
  NvrVendor, DeploymentMode, NvrLifecycleStatus,
} from '../nvr-adapter/types'

// ─── 共通 ────────────────────────────────────────────────────────────────────

export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── stores 拡張カラム (F46.6) ───────────────────────────────────────────────

export interface StoreTier3Columns {
  deployment_mode:      DeploymentMode
  nvr_vendor:           NvrVendor | null
  nvr_model:            string | null
  nvr_endpoint:         string | null
  nvr_credentials_ref:  string | null              // uuid
  nvr_options:          Record<string, unknown>
  central_node_id:      string | null              // uuid
  nvr_installed_at:     string | null              // date (ISO)
  nvr_fw_version:       string | null
  nvr_fw_detected_at:   string | null              // timestamptz
  nvr_eol_date:         string | null              // date
  nvr_eos_date:         string | null              // date
  nvr_replace_by:       string | null              // date (GENERATED)
}

// ─── central_nodes テーブル (F46.6) ──────────────────────────────────────────

export interface CentralNodesRow {
  id:                string
  hostname:          string
  region:            string | null
  capacity_stores:   number
  status:            'active' | 'draining' | 'down'
  lease_held_until:  string | null
  last_heartbeat:    string | null
  metadata:          Record<string, unknown>
  created_at:        string
  updated_at:        string
}

export type CentralNodesInsert = Partial<CentralNodesRow> & {
  hostname: string
}

export type CentralNodesUpdate = Partial<CentralNodesRow>

// ─── nvr_models テーブル (F46.7) ─────────────────────────────────────────────

export interface NvrModelsRow {
  id:                string
  vendor:            string
  model_family:      string
  model_number:      string
  display_name:      string
  released_at:       string | null
  eol_announced_at:  string | null
  eol_date:          string | null
  eos_date:          string | null
  max_channels:      number | null
  max_resolution:    string | null
  source_url:        string | null
  notes:             string | null
  created_at:        string
  updated_at:        string
}

export type NvrModelsInsert = Partial<NvrModelsRow> & {
  vendor:       string
  model_family: string
  model_number: string
  display_name: string
}

// ─── v_store_nvr_lifecycle VIEW (F46.8) ──────────────────────────────────────

export interface StoreNvrLifecycleRow {
  store_id:                  string
  store_name:                string
  deployment_mode:           DeploymentMode
  nvr_vendor:                NvrVendor | null
  nvr_model:                 string | null
  nvr_fw_version:            string | null
  nvr_fw_detected_at:        string | null
  nvr_installed_at:          string | null
  nvr_eol_date:              string | null
  nvr_eos_date:              string | null
  nvr_replace_by:            string | null
  months_until_eos:          number | null
  years_in_service:          number | null
  months_until_replace_by:   number | null
  lifecycle_status:          NvrLifecycleStatus
}

export interface NvrLifecycleSummaryRow {
  lifecycle_status:  NvrLifecycleStatus
  store_count:       number
  sort_order:        number
}

export interface NvrLifecycleByModelRow {
  nvr_vendor:        string | null
  nvr_model:         string | null
  lifecycle_status:  NvrLifecycleStatus
  store_count:       number
}

// ─── Database 集約型 (Supabase クライアント用) ──────────────────────────────
//
// 本来は supabase gen types typescript の出力に含まれる全テーブル定義が必要。
// Phase 0 の暫定版では Tier 3 関連だけを定義し、既存テーブル参照は any として
// 抜け穴を残しておく (Phase 0 中盤に gen-db-types.sh を本物に差し替える)。

export interface Database {
  public: {
    Tables: {
      central_nodes: {
        Row:    CentralNodesRow
        Insert: CentralNodesInsert
        Update: CentralNodesUpdate
      }
      nvr_models: {
        Row:    NvrModelsRow
        Insert: NvrModelsInsert
        Update: Partial<NvrModelsRow>
      }
      // 既存テーブル (stores 等) は再生成時に追加される。
      // 暫定版では明示的にキーを羅列せず、index signature を緩めて any を許す。
      // gen-db-types.sh の出力で上書きされる前提。
      [key: string]: {
        Row:    Record<string, unknown> & Record<string, never>
        Insert: Record<string, unknown> & Record<string, never>
        Update: Record<string, unknown> & Record<string, never>
      } | unknown
    }
    Views: {
      v_store_nvr_lifecycle: {
        Row: StoreNvrLifecycleRow
      }
      v_nvr_lifecycle_summary: {
        Row: NvrLifecycleSummaryRow
      }
      v_nvr_lifecycle_by_model: {
        Row: NvrLifecycleByModelRow
      }
    }
    Functions: Record<string, unknown>
    Enums:     Record<string, unknown>
  }
}
