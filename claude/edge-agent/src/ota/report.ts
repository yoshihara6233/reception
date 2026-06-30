/**
 * heartbeat に相乗りする OTA 報告値（現行版・OTA状態）。
 * EDGE_ROOT 未設定（OTA 無効＝旧レイアウト/ローカル/CI）なら null を返し、
 * heartbeat 側は新規カラムを送らない＝未 migration の DB を壊さない。
 */
import { config } from '../config.js'
import { resolvePaths, readRunningVersion, readState } from './runner.js'

export interface OtaReport {
  agent_version: string | null
  ota_status: string | null
}

export async function reportedOta(): Promise<OtaReport> {
  const paths = resolvePaths(config.EDGE_ROOT)
  if (!paths) return { agent_version: null, ota_status: null }
  try {
    const v = await readRunningVersion(paths)
    const s = await readState(paths, v)
    return { agent_version: v, ota_status: s.status }
  } catch {
    return { agent_version: null, ota_status: null }
  }
}
