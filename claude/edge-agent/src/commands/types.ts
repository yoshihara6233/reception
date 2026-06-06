/**
 * F46.14: コマンド共通型
 *
 * pending_commands テーブルの「コマンド」を adapter 経由で実行するための共通
 * 入出力型を定義。各コマンドハンドラはこの型に従い、adapter を vendor で
 * 動的解決して処理する。
 *
 * 設計原則:
 *   - ベンダー名を if-else しない (adapter が抽象化)
 *   - capability 不足は UnsupportedOperationError として早期に投げる
 *   - 副作用 (DB 更新、ファイル保存) は別ヘルパーに切り出し、純粋な処理を保つ
 */
import type { NvrAdapter } from '../adapters/_base'

export interface StoreNvrConfig {
  storeId:             string
  nvrVendor:           string                       // adapter registry の key
  nvrEndpoint:         string
  nvrCredentialsRef:   string                       // vault 参照
  nvrOptions:          Record<string, unknown>
  nvrModel?:           string | null
}

export interface CommandContext {
  /** 取得済 adapter (cache 経由) */
  adapter:  NvrAdapter
  /** 店舗設定 */
  store:    StoreNvrConfig
  /** 親 pending_command の ID (ログ・監査用) */
  commandId: string
}

export interface CommandResult<T = unknown> {
  ok:        boolean
  data?:     T
  error?:    string
  /** デバッグ用 metadata (vendor 情報、所要時間など) */
  metadata?: Record<string, unknown>
}
