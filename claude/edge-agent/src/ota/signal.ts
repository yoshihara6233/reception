/**
 * 起動後の健全性シグナル（循環依存回避のための薄い共有状態）。
 *  - storage.heartbeat() が成功時に markHeartbeatOk() を呼ぶ
 *  - index.ts の verifyOnBoot が healthProbe() で「新版で heartbeat 到達したか + 安定時間」を読む
 */
import type { HealthProbeInput } from './core.js'

const bootAt = Date.now()
let heartbeatOk = false

/** heartbeat がクラウドへ到達したことを記録（起動後に1回でも成功すれば true）。 */
export function markHeartbeatOk(): void {
  heartbeatOk = true
}

/** verifyOnBoot に渡す健全性プローブを組む。 */
export function healthProbe(minStableMs: number): HealthProbeInput {
  return { heartbeatReached: heartbeatOk, stableMs: Date.now() - bootAt, minStableMs }
}
