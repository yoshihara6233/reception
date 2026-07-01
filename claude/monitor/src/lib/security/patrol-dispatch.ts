/**
 * 警備 巡回ディスパッチの共通ヘルパー（Phase A）。
 *
 * cron スケジューラ（/api/cron/security-patrol）と 手動トリガ（今すぐ巡回）の
 * 双方から使う。撮影対象カメラの列挙と capture_snapshot コマンド生成を1箇所に集約し、
 * 2経路でロジックが乖離しないようにする。実際の pending_command 書込は各呼び出し側で行う
 * （busy/offline の扱いが異なるため）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { EdgeCommand } from '@/lib/edge/commands'

/** ingest の絶対URL（エッジはコマンド内のこのURLへ multipart POST する）。 */
export function patrolIngestUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://intereco-monitor.vercel.app'
  return `${base}/api/security/patrol/ingest`
}

/**
 * 店舗の巡回対象カメラ ID を返す。
 * 店舗の全カメラのうち、security_camera_config で patrol_enabled=false のものだけ除外
 * （config 行が無いカメラは既定 true 扱いで含める）。
 */
export async function listPatrolCameraIds(
  service: SupabaseClient,
  storeId: string,
): Promise<string[]> {
  const { data: cams } = await service
    .from('recorder_cameras')
    .select('id')
    .eq('store_id', storeId)
  const camIds = (cams ?? []).map((c) => c.id as string)
  if (!camIds.length) return []

  const { data: cfgs } = await service
    .from('security_camera_config')
    .select('camera_id, patrol_enabled')
    .in('camera_id', camIds)
  const disabled = new Set(
    (cfgs ?? []).filter((c) => c.patrol_enabled === false).map((c) => c.camera_id as string),
  )
  return camIds.filter((id) => !disabled.has(id))
}

/** capture_snapshot コマンドを生成（request_id は毎回新規）。 */
export function buildCaptureCommand(runId: string, cameraIds: string[]): EdgeCommand {
  return {
    action: 'capture_snapshot',
    request_id: randomUUID(),
    run_id: runId,
    camera_ids: cameraIds,
    ingest_url: patrolIngestUrl(),
  }
}
