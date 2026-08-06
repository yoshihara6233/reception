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
import type { SupabaseClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSupabase, getScopedSupabase } from '../supabase.js'
import { OnvifSoapClient } from '../adapters/onvif/onvif-soap-client.js'
import { resolveOnvifRtspUrl } from '../adapters/onvif/onvif-rtsp.js'
import { injectRtspCreds, captureRtspKeyframe } from '../rtsp/keyframe.js'
import { getOnvifSnapshotUrl, fetchOnvifJpeg } from '../adapters/onvif/onvif-snapshot.js'
import { buildOnvifEndpoint } from './onvif-endpoint.js'
import { fetchIproNvrChannels } from '../adapters/i-pro/nvr-info.js'
import { buildIproNvrEndpoint, captureIproNvrJpeg } from '../adapters/i-pro/nvr-live.js'
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

/**
 * i-PRO NVR 経由構成の探索。ONVIF は NU101 に無い（`/onvif/device_service` が 404）ので、
 * NVR のカメラ接続情報 CGI で「実際に繋がっているチャンネル」を列挙する。
 * 返す形は ONVIF 探索と同じ（管理UIの「＋カメラ追加」がそのまま使える）。
 */
async function runIproNvrDiscovery(rec: RecorderRow): Promise<unknown> {
  const channels = await fetchIproNvrChannels({
    endpoint: buildIproNvrEndpoint(rec.host, rec.onvif_port),
    username: rec.username,
    password: decodePassword(rec.password_enc),
    timeoutMs: 12_000,
  })
  const connected = channels.filter((c) => c.connected)
  return {
    device: { manufacturer: 'i-PRO', model: 'NVR (recorder-via)' },
    profiles: connected.map((c) => ({
      token: `ch${c.channel}`,
      name: `CAM${String(c.channel).padStart(2, '0')}`,
      encoding: null,
    })),
    count: connected.length,
    scanned: channels.length,
  }
}

/** i-PRO NVR は実際のライブ経路（push.cgi）で1コマ取れるかを見るのが唯一正しい到達確認。 */
async function runIproNvrConnectionTest(rec: RecorderRow, channel: number): Promise<unknown> {
  const opts = {
    endpoint: buildIproNvrEndpoint(rec.host, rec.onvif_port),
    username: rec.username,
    password: decodePassword(rec.password_enc),
    timeoutMs: 15_000,
  }
  try {
    const jpeg = await captureIproNvrJpeg(opts, channel)
    return { ok: true, method: 'ipro_nvr_push', bytes: jpeg.length }
  } catch (e) {
    return { ok: false, method: 'ipro_nvr_push', error: String((e as Error)?.message ?? e) }
  }
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
  // 1) ONVIF snapshot (HTTP JPEG) を最優先。grid/ライブ/BCP と同じ経路で、
  //    NVR がメイン RTSP を占有していても（i-PRO+NVR 構成は新規 RTSP が 503/競合で
  //    取れない）GetSnapshotUri は別枠で取得できる。到達性判定はこちらが正しい。
  let snapshotError: string | undefined
  try {
    const snapUrl = await getOnvifSnapshotUrl(opts, rec.host, channel)
    if (snapUrl) {
      const jpeg = await fetchOnvifJpeg(snapUrl, opts.username, opts.password, opts.timeoutMs)
      return { ok: true, method: 'onvif_snapshot', bytes: jpeg.length }
    }
    snapshotError = 'GetSnapshotUri 非対応（JPEGプロファイル無し）'
  } catch (e) {
    snapshotError = String((e as Error)?.message ?? e)
  }

  // 2) フォールバック: RTSP キーフレーム（snapshot 非対応機）。
  try {
    const base = await resolveOnvifRtspUrl(opts, channel)
    const rtsp = injectRtspCreds(base, opts.username, opts.password)
    const frame = await captureRtspKeyframe(rtsp, config.FFMPEG_BIN)
    return { ok: true, method: 'rtsp_keyframe', bytes: frame.length }
  } catch (e) {
    return {
      ok: false,
      method: 'rtsp_keyframe',
      error: String((e as Error)?.message ?? e),
      snapshotError,
    }
  }
}

/**
 * edge_jobs テーブル操作に使うクライアントを選ぶ（Phase B1）。
 * - EDGE_SCOPED_JOBS=false: getSupabase()（Phase B3 の EDGE_SCOPED_DB=true なら
 *   それ自体がスコープトークンのクライアント）。
 * - true: このエッジ専用の短命スコープトークン。未取得/失効間近なら null
 *   → 呼び出し側はそのtickをスキップ（service_role には落ちない＝越権面を作らない）。
 * recorders 読み取り(resolveRecorder)は getSupabase() 経由。Phase B2 の RLS で
 * 自エッジ配下だけに絞られるため、スコープモードでもそのまま動く。
 */
function jobsClient(): SupabaseClient | null {
  if (!config.EDGE_SCOPED_JOBS) return getSupabase()
  return getScopedSupabase()
}

async function processJob(job: EdgeJob, jobsSupa: SupabaseClient): Promise<void> {
  try {
    const recorderId = job.params?.recorder_id
    if (!recorderId) throw new Error('params.recorder_id required')
    const rec = await resolveRecorder(recorderId)
    if (!rec) throw new Error('recorder not found for this edge')

    const channel = job.params?.channel ?? 1
    const isNvr = rec.vendor === 'i-pro-nvr'
    const result = job.kind === 'onvif_discovery'
      ? (isNvr ? await runIproNvrDiscovery(rec) : await runOnvifDiscovery(rec))
      : (isNvr ? await runIproNvrConnectionTest(rec, channel) : await runConnectionTest(rec, channel))

    await jobsSupa.from('edge_jobs')
      .update({ status: 'done', result, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    logger.info({ job: job.id, kind: job.kind }, 'edge_jobs: done')
  } catch (e) {
    await jobsSupa.from('edge_jobs')
      .update({ status: 'error', error: String((e as Error)?.message ?? e), updated_at: new Date().toISOString() })
      .eq('id', job.id)
    logger.warn({ job: job.id, err: String(e) }, 'edge_jobs: failed')
  }
}

async function pollOnce(): Promise<void> {
  const supa = jobsClient()
  if (!supa) { logger.debug('edge_jobs: scoped token not ready, skipping tick'); return }
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

  await processJob(data as EdgeJob, supa)
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
