import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSupabase, refreshSupabaseKey } from '../supabase.js'

const BUCKET = 'edge-grids'
const KEY    = `edges/${config.EDGE_ID}/grid.jpg`

/**
 * Overwrite the latest grid JPEG in Supabase Storage.
 * The bucket should be private; viewers fetch via signed URLs from /api.
 */
export async function uploadGridJpeg(buf: Buffer): Promise<void> {
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

/** Update the edge_devices row with a fresh heartbeat. */
export async function heartbeat(state: string): Promise<void> {
  const { error } = await getSupabase()
    .from('edge_devices')
    .update({ status: state, last_seen_at: new Date().toISOString() })
    .eq('id', config.EDGE_ID)
  if (!error) return
  logger.warn({ err: error.message }, 'heartbeat: update failed')
  // 鍵失効(ローテ)の可能性 → monitor から鍵を取り直して1回だけ再試行（無停止追従）。
  await refreshSupabaseKey()
  const retry = await getSupabase()
    .from('edge_devices')
    .update({ status: state, last_seen_at: new Date().toISOString() })
    .eq('id', config.EDGE_ID)
  if (retry.error) logger.warn({ err: retry.error.message }, 'heartbeat: retry after key refresh failed')
  else logger.info('heartbeat: recovered after key refresh')
}
