/**
 * NVMS 同期ワーカー（Phase 1.5 M2/M3 のエッジ側）
 *
 * このエッジ配下の vendor='nvms' レコーダについて:
 *   - 10分ごと: NVMS の /cameras + /camera-folders を読み、クラウド
 *     /api/edge/nvms-sync へスナップショットを送る（500台ずつ分割）。
 *     カメラの手動登録を不要にする — NVMS 側の追加・改名・フォルダ移動・
 *     削除（→enabled=false）がクラウドへ流れ込む。**正は常に NVMS**。
 *   - 5分ごと: /health/detail + /cameras + /storage を集約した死活サマリを
 *     /api/edge/nvms-health へ送る（報告型監視。クラウドは 10万台を個別
 *     ポーリングしない — 設計書 M3）。
 *
 * 失敗は次周期に任せて黙って再試行する（クラウド側は health_at の鮮度で
 * 沈黙を検知する）。NVMS 側の一時的な 5xx やネットワーク断で落ちないよう、
 * レコーダ単位で握って続行する。
 */
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSupabase } from '../supabase.js'
import { decryptSecret } from '@intereco/shared'
import { nvmsEndpoint } from '../adapters/nvms/client.js'
import { buildSyncRows, buildHealthSummary, type NvmsCameraRaw, type NvmsFolder } from '../adapters/nvms/sync-logic.js'

const SYNC_MS   = 10 * 60_000
const HEALTH_MS = 5 * 60_000
const CHUNK     = 500

interface NvmsRecorder { id: string; endpoint: string; apiKey: string }

async function loadNvmsRecorders(): Promise<NvmsRecorder[]> {
  const { data, error } = await getSupabase()
    .from('recorders')
    .select('id, host, password_enc, vendor, edge_id')
    .eq('edge_id', config.EDGE_ID)
    .eq('vendor', 'nvms')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id:       r.id as string,
    endpoint: nvmsEndpoint(r.host as string),
    apiKey:   decryptSecret(r.password_enc as string),
  }))
}

async function nvmsGet<T>(rec: NvmsRecorder, path: string): Promise<T> {
  const res = await fetch(`${rec.endpoint}${path}`, {
    headers: { Authorization: `Bearer ${rec.apiKey}` },
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`nvms GET ${path} → HTTP ${res.status}`)
  return await res.json() as T
}

async function cloudPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${config.MONITOR_URL}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${config.EDGE_DEVICE_TOKEN}`,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`cloud POST ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
}

/** カメラ＋フォルダを読み、クラウドへ分割送信する。 */
export async function syncCamerasOnce(rec: NvmsRecorder): Promise<void> {
  const folders = await nvmsGet<NvmsFolder[]>(rec, '/api/v1/camera-folders')
  const cameras = await nvmsGet<NvmsCameraRaw[]>(rec, '/api/v1/cameras')

  const presentIds = cameras.map((c) => c.id)
  const rows = buildSyncRows(cameras, folders)

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const final = i + CHUNK >= rows.length
    await cloudPost('/api/edge/nvms-sync', {
      recorderId: rec.id, final, presentIds: final ? presentIds : [], cameras: chunk,
    })
  }
  logger.info({ recorderId: rec.id, cameras: rows.length, folders: folders.length }, 'nvms-sync: cameras synced')
}

/** 死活サマリを組み立ててクラウドへ送る。 */
export async function pushHealthOnce(rec: NvmsRecorder): Promise<void> {
  // /cameras は同期と重複して読むが、down の内訳（名前・フォルダ）が要るのはここだけ。
  const [detail, cameras, storage, folders] = await Promise.all([
    nvmsGet<Record<string, unknown>>(rec, '/api/v1/health/detail'),
    nvmsGet<NvmsCameraRaw[]>(rec, '/api/v1/cameras'),
    nvmsGet<Record<string, unknown>>(rec, '/api/v1/storage').catch(() => null),
    nvmsGet<NvmsFolder[]>(rec, '/api/v1/camera-folders').catch(() => [] as NvmsFolder[]),
  ])

  const health = buildHealthSummary(detail, cameras, folders, storage)
  await cloudPost('/api/edge/nvms-health', { recorderId: rec.id, health })
  logger.debug({ recorderId: rec.id, offline: health.cameras_offline }, 'nvms-sync: health pushed')
}

async function forEachRecorder(job: (r: NvmsRecorder) => Promise<void>, label: string): Promise<void> {
  let recs: NvmsRecorder[]
  try { recs = await loadNvmsRecorders() } catch (e) {
    return logger.debug({ err: String(e) }, `nvms-sync: recorder load failed (${label})`)
  }
  for (const rec of recs) {
    try { await job(rec) } catch (e) {
      logger.warn({ recorderId: rec.id, err: String(e) }, `nvms-sync: ${label} failed（次周期に再試行）`)
    }
  }
}

export function startNvmsSyncWorker(): { close: () => void } {
  if (!config.MONITOR_URL) {
    logger.info('nvms-sync: MONITOR_URL 未設定のため停止（NVMS レコーダを使う場合は設定が必要）')
    return { close() {} }
  }
  let stopped = false
  let busySync = false, busyHealth = false

  const runSync = () => {
    if (stopped || busySync) return
    busySync = true
    forEachRecorder(syncCamerasOnce, 'camera sync').finally(() => { busySync = false })
  }
  const runHealth = () => {
    if (stopped || busyHealth) return
    busyHealth = true
    forEachRecorder(pushHealthOnce, 'health push').finally(() => { busyHealth = false })
  }

  runSync(); runHealth()
  const t1 = setInterval(runSync, SYNC_MS)
  const t2 = setInterval(runHealth, HEALTH_MS)
  return { close() { stopped = true; clearInterval(t1); clearInterval(t2) } }
}
