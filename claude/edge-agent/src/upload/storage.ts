import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSupabase, refreshSupabaseKey } from '../supabase.js'
import { reportedOta } from '../ota/report.js'
import { markHeartbeatOk } from '../ota/signal.js'
import { putGridToR2, putSnapshotToR2 } from './edge-images-r2.js'

const BUCKET = 'edge-grids'
const KEY    = `edges/${config.EDGE_ID}/grid.jpg`

/**
 * Overwrite the latest grid JPEG.
 *
 * R2 を優先する（エグレス無料）。R2 未設定・presign 取得不可・PUT 失敗のときは
 * 従来どおり Supabase Storage へ上げる＝どちらの経路でも配信側が拾える。
 * The bucket should be private; viewers fetch via signed URLs from /api.
 */
export async function uploadGridJpeg(buf: Buffer, cameraIds: string[] = []): Promise<void> {
  if (await putGridToR2(buf, cameraIds)) {
    logger.debug({ bytes: buf.length }, 'storage: grid → r2 ok')
    return
  }
  const { error } = await getSupabase().storage.from(BUCKET).upload(KEY, buf, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
  })
  if (error) {
    logger.error({ err: error.message }, 'storage: upload failed')
    throw error
  }
  logger.debug({ bytes: buf.length }, 'storage: upload ok')
}

/**
 * Upload a per-camera snapshot. Used by single-camera live mode and as a
 * source for the stitched grid (composed by the edge before uploading).
 * Path mirrors the grid object for symmetry.
 */
export async function uploadCameraSnapshot(cameraId: string, buf: Buffer): Promise<void> {
  // R2 優先（エグレス無料）。失敗時は Supabase へフォールバック。
  if (await putSnapshotToR2(cameraId, buf)) {
    logger.debug({ bytes: buf.length, cameraId }, 'storage: cam snapshot → r2 ok')
    return
  }
  const key = `edges/${config.EDGE_ID}/cam/${cameraId}/snapshot.jpg`
  const { error } = await getSupabase().storage.from(BUCKET).upload(key, buf, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
  })
  if (error) {
    logger.error({ err: error.message, key }, 'storage: cam snapshot upload failed')
    throw error
  }
  logger.debug({ bytes: buf.length, cameraId }, 'storage: cam snapshot ok')
}

/**
 * Update the edge_devices row with a fresh heartbeat.
 *
 * OTA 有効機（EDGE_ROOT 設定済）は agent_version / ota_status も相乗りで報告する。
 * 未設定機（旧レイアウト/ローカル/CI）は従来通り status / last_seen_at だけ送る
 * ＝ 新規カラム未 migration の DB を壊さない（カラム不明エラーを避ける）。
 */
export async function heartbeat(state: string): Promise<void> {
  const payload: Record<string, unknown> = {
    status: state,
    last_seen_at: new Date().toISOString(),
  }
  const ota = await reportedOta()
  if (ota.agent_version) payload.agent_version = ota.agent_version
  if (ota.ota_status) payload.ota_status = ota.ota_status

  const { error } = await getSupabase()
    .from('edge_devices')
    .update(payload)
    .eq('id', config.EDGE_ID)
  if (!error) {
    markHeartbeatOk() // 新版の健全性プローブ用（到達＝OK）
    return
  }
  logger.warn({ err: error.message }, 'heartbeat: update failed')
  // 鍵失効(ローテ)の可能性 → monitor から鍵を取り直して1回だけ再試行（無停止追従）。
  await refreshSupabaseKey()
  const retry = await getSupabase()
    .from('edge_devices')
    .update(payload)
    .eq('id', config.EDGE_ID)
  if (retry.error) logger.warn({ err: retry.error.message }, 'heartbeat: retry after key refresh failed')
  else {
    markHeartbeatOk()
    logger.info('heartbeat: recovered after key refresh')
  }
}
