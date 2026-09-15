/**
 * NVMS 合成グリッド (GET /api/v1/grid.jpg) を使えるかの判定 — 純粋ロジック。
 *
 * grid.jpg は「cameras の並び順がそのままタイル位置（0 起点・行優先・隙間なし）」
 * という契約なので、エッジ側のスロット配置がその形に一致するときだけ使える。
 * 具体的には:
 *   - 表示対象（grid_pos 0..15）の全カメラが vendor 'nvms'
 *   - 全カメラが同一レコーダ（host + API キーが同じ）
 *   - grid_pos が 0 から連番（0..n-1、重複・歯抜けなし）
 * Phase 1.5 の start_grid camera_ids 経路はエッジが 0..n-1 を機械的に振るので
 * 常にこの形になる。手動割付で歯抜けにした場合や他ベンダ混在時は null を返し、
 * 呼び出し側は従来のカメラ別合成を使う。
 */
import type { CameraDescriptor } from '../../types.js'

export interface NvmsGridPlan {
  /** recorder.host そのまま（nvmsEndpoint() に渡す） */
  host: string
  /** API キー（recorder.password） */
  apiKey: string
  /** grid_pos 0..n-1 の順に並べた NVMS カメラ ID（= channel） */
  channels: number[]
  /** uploadGridJpeg に渡す camId（channels と同順） */
  camIds: string[]
}

const SLOTS = 16

export function planNvmsGrid(cameras: CameraDescriptor[]): NvmsGridPlan | null {
  const shown = cameras.filter((c) => c.grid_pos >= 0 && c.grid_pos < SLOTS)
  if (shown.length === 0) return null
  if (!shown.every((c) => c.recorder.vendor === 'nvms')) return null

  const { host, password } = shown[0].recorder
  if (!shown.every((c) => c.recorder.host === host && c.recorder.password === password)) {
    return null
  }

  // grid_pos が 0..n-1 の連番であること（並び順＝タイル位置の契約を満たせるか）
  const byPos = [...shown].sort((a, b) => a.grid_pos - b.grid_pos)
  if (!byPos.every((c, i) => c.grid_pos === i)) return null

  return {
    host,
    apiKey: password,
    channels: byPos.map((c) => c.channel),
    camIds:   byPos.map((c) => c.id),
  }
}
