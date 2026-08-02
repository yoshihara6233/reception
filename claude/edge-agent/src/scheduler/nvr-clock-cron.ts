/**
 * NVR 時計ズレの定期実測 → edge_devices へ報告。
 *
 * 起動 1 分後に初回、以後 30 分毎に、担当レコーダ（Frigate 以外の先頭 1 台）の
 * HTTP Date ヘッダから時計差を実測し edge_devices.nvr_clock_offset_sec /
 * nvr_clock_checked_at へ書く。/infra と /admin/edges/[id] がこれを表示し、
 * 閾値超過を警告する（「気づかぬうちに +3 分」の再発防止・handbook ギャップ #5）。
 *
 * 未 migration の DB ではカラム不明で update が失敗するが、debug ログのみで
 * 本体動作には影響させない（heartbeat と同じフェイルソフト方針）。
 */
import { logger } from '../logger.js'
import { getSupabase } from '../supabase.js'
import { config } from '../config.js'
import { loadCameras } from '../cameras.js'
import { measureNvrClockOffsetSec } from '../util/nvr-clock.js'

const INITIAL_DELAY_MS = 60_000
const INTERVAL_MS = 30 * 60_000
/** これ以上ズレたら warn ログ（クラウド側の表示閾値と同じ）。 */
export const NVR_CLOCK_WARN_SEC = 10

export async function reportNvrClockOffsetOnce(): Promise<void> {
  try {
    const cams = await loadCameras()
    const rec = cams
      .map((c) => c.recorder)
      .find((r) => r.vendor !== 'frigate' && (r.vod_host || r.host))
    if (!rec) return

    const offset = await measureNvrClockOffsetSec(rec.vod_host ?? rec.host)
    if (offset == null) return

    if (Math.abs(offset) >= NVR_CLOCK_WARN_SEC) {
      logger.warn({ offsetSec: offset, host: rec.vod_host ?? rec.host }, 'nvr-clock: clock skew detected')
    } else {
      logger.debug({ offsetSec: offset }, 'nvr-clock: ok')
    }

    const { error } = await getSupabase()
      .from('edge_devices')
      .update({
        nvr_clock_offset_sec: offset,
        nvr_clock_checked_at: new Date().toISOString(),
      })
      .eq('id', config.EDGE_ID)
    if (error) logger.debug({ err: error.message }, 'nvr-clock: report failed (column not migrated yet?)')
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'nvr-clock: run failed')
  }
}

/** 監視開始。戻り値は停止関数（shutdown 用）。 */
export function startNvrClockWatch(): () => void {
  let interval: NodeJS.Timeout | null = null
  const initial = setTimeout(() => {
    void reportNvrClockOffsetOnce()
    interval = setInterval(() => { void reportNvrClockOffsetOnce() }, INTERVAL_MS)
  }, INITIAL_DELAY_MS)
  return () => {
    clearTimeout(initial)
    if (interval) clearInterval(interval)
  }
}
