/**
 * @intereco/shared — public API
 *
 * 両 app (monitor + edge-agent) で共有する型・定数・エラー・基本ユーティリティ。
 *
 * 使い方:
 *   import { NvrAdapter, CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
 *   import { HEARTBEAT_INTERVAL_CENTRAL_SEC } from '@intereco/shared/constants'
 */
export * from './nvr-adapter'
export * from './constants'
export * from './commands'
