/**
 * 映像閲覧アクセスログ（データガバナンス G3）。
 *
 * 証跡の静止画アクセス（発報スナップ / 発報前後フレーム / 巡回スナップ / BCPエクスポート）を
 * footage_access_log に記録する。ライブ/グリッド/VOD の閲覧は既存 live_sessions が担当。
 *
 * - 5分バケットで dedup（ポーリング/ギャラリー再描画での膨張を防ぐ・UNIQUE で ON CONFLICT DO NOTHING）。
 * - best-effort: 記録失敗で映像配信を妨げない（呼び出し側は void で fire-and-forget）。
 * - service client で INSERT（RLS バイパス）。読み取りは admin ロールのみ（migration の RLS）。
 */
import { createSupabaseService } from '@/lib/supabase/server'

const BUCKET_MS = 5 * 60 * 1000

export type FootageAccessType =
  | 'alarm_snapshot'
  | 'alarm_frame'
  | 'patrol_snapshot'
  | 'bcp_export'

export interface FootageAccessEntry {
  actorUserId: string
  storeId?:    string | null
  accessType:  FootageAccessType
  resourceId?: string | null
  cameraId?:   string | null
}

export async function recordFootageAccess(e: FootageAccessEntry): Promise<void> {
  try {
    const bucket = new Date(Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS).toISOString()
    const svc = createSupabaseService()
    await svc.from('footage_access_log').upsert(
      {
        actor_user_id: e.actorUserId,
        store_id:      e.storeId ?? null,
        access_type:   e.accessType,
        resource_id:   e.resourceId ?? null,
        camera_id:     e.cameraId ?? null,
        bucket,
      },
      { onConflict: 'actor_user_id,access_type,resource_id,bucket', ignoreDuplicates: true },
    )
  } catch {
    /* best-effort: 閲覧を妨げない */
  }
}
