/**
 * Edge ジョブワーカ（Phase B Stage 2b）。
 *
 * monitor が `edge_jobs` に pending ジョブを作成 → このワーカが自分(EDGE_ID)宛を拾い、
 * ONVIF探索 / 接続テスト を実行して result/status を書き戻す。結果は monitor がポーリング。
 *
 * - kind='onvif_discovery': recorder の ONVIF からデバイス情報＋プロファイル一覧を取得。
 * - kind='connection_test': recorder の RTSP(ONVIF解決) から1フレーム取得して到達性確認。
 *
 * クレデンシャルは params に載せず recorder_id 参照で DB から解決（漏洩面を作らない）。
 * edge_jobs 未作成(マイグレーション未適用)でも poll エラーは debug に留め、無害に no-op。
 */
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSupabase } from '../supabase.js'
import { OnvifSoapClient } from '../adapters/onvif/onvif-soap-client.js'
import { resolveOnvifRtspUrl } from '../adapters/onvif/onvif-rtsp.js'
import { injectRtspCreds, captureRtspKeyframe } from '../rtsp/keyframe.js'
import { buildOnvifEndpoint } from './onvif-endpoint.js'
import { decryptSecret } from '@intereco/shared'

const POLL_MS = 3000

interface RecorderRow {
  id: string; vendor: string; host: string; onvif_port: number | null
  username: string; password_enc: string
}
interface EdgeJob {
  id: string; kind: 'onvif_discovery' | 'connection_test'; params: { recorder_id?: string; channel?: number }
}

/** 保存値(enc:v1 / plain: / 生)を平文に復号。 */
function decodePassword(stored: string): string {
  return decryptSecret(stored)
}

async function resolveRecorder(recorderId: string): Promise<RecorderRow | null> {
  const { data } = await getSupabase()
    .from('recorders')
    .select('id, vendor, host, onvif_port, username, password_enc')
    .eq('id', recorderId)
    .eq('edge_id', config.EDGE_ID)   // 他エッジのレコーダは触らない
    .single()
  return (data as RecorderRow | null) ?? null
}

async function runOnvifDiscovery(rec: RecorderRow): Promise<unknown> {
  const client = new OnvifSoapClient({
    endpoint: buildOnvifEndpoint(rec.host, rec.onvif_port),
    username: rec.username,
    password: decodePassword(rec.password_enc),
    timeoutMs: 10_000,
  })
  const [device, profiles] = await Promise.all([
    client.getDeviceInformation().catch(() => null),
    client.getProfiles(),
  ])
  return {
    device,
    profiles: profiles.map((p) => ({ token: p.token, name: p.name, encoding: p.encoding ?? null })),
    count: profiles.length,
  }
}

async function runConnectionTest(rec: RecorderRow, channel: number): Promise<unknown> {
  const opts = {
    endpoint: buildOnvifEndpoint(rec.host, rec.onvif_port),
    username: rec.username,
    password: decodePassword(rec.password_enc),
    timeoutMs: 10_000,
  }
  try {
    const base = await resolveOnvifRtspUrl(opts, channel)
    const rtsp = injectRtspCreds(base, opts.username, opts.password)
    const frame = await captureRtspKeyframe(rtsp, config.FFMPEG_BIN)
    return { ok: true, method: 'rtsp_keyframe', bytes: frame.length }
  } catch (e) {
    return { ok: false, method: 'rtsp_keyframe', error: String((e as Error)?.message ?? e) }
  }
}

async function processJob(job: EdgeJob): Promise<void> {
  const supa = getSupabase()
  try {
    const recorderId = job.params?.recorder_id
    if (!recorderId) throw new Error('params.recorder_id required')
    const rec = await resolveRecorder(recorderId)
    if (!rec) throw new Error('recorder not found for this edge')

    const result = job.kind === 'onvif_discovery'
      ? await runOnvifDiscovery(rec)
      : await runConnectionTest(rec, job.params?.channel ?? 1)

    await supa.from('edge_jobs')
      .update({ status: 'done', result, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    logger.info({ job: job.id, kind: job.kind }, 'edge_jobs: done')
  } catch (e) {
    await supa.from('edge_jobs')
      .update({ status: 'error', error: String((e as Error)?.message ?? e), updated_at: new Date().toISOString() })
      .eq('id', job.id)
    logger.warn({ job: job.id, err: String(e) }, 'edge_jobs: failed')
  }
}

async function pollOnce(): Promise<void> {
  const supa = getSupabase()
  const { data, error } = await supa
    .from('edge_jobs')
    .select('id, kind, params')
    .eq('edge_id', config.EDGE_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) { logger.debug({ err: error.message }, 'edge_jobs: poll skipped'); return }
  if (!data) return

  // 原子的クレーム: pending の時だけ running に。競合(0行)はスキップ。
  const { data: claimed } = await supa
    .from('edge_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', (data as EdgeJob).id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return

  await processJob(data as EdgeJob)
}

/** ジョブポーリング開始（go2rtc sync と同じ setInterval パターン）。 */
export function startEdgeJobWorker(): { close: () => void } {
  let stopped = false
  let busy = false
  const run = () => {
    if (stopped || busy) return
    busy = true
    pollOnce().catch((e) => logger.debug({ err: String(e) }, 'edge_jobs: run error')).finally(() => { busy = false })
  }
  run()
  const timer = setInterval(run, POLL_MS)
  return { close() { stopped = true; clearInterval(timer) } }
}
