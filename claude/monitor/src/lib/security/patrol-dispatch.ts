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
 * エッジ配下の巡回対象カメラ ID を返す（＝そのエッジの全カメラ）。
 *
 * カメラは店舗に直接紐づかない: recorder_cameras → recorders(edge_id) → edge_devices(store_id)。
 * 呼び出し側は既に対象店舗の edge を引いているので edge.id で辿る。
 * 証跡型巡回では「全カメラを常に巡回」する方針のため、カメラ別の除外設定は持たない。
 */
export async function listPatrolCameraIds(
  service: SupabaseClient,
  edgeId: string,
): Promise<string[]> {
  const { data: recs } = await service
    .from('recorders')
    .select('id')
    .eq('edge_id', edgeId)
  const recorderIds = (recs ?? []).map((r) => r.id as string)
  if (!recorderIds.length) return []

  const { data: cams } = await service
    .from('recorder_cameras')
    .select('id')
    .in('recorder_id', recorderIds)
  return (cams ?? []).map((c) => c.id as string)
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
