/**
 * 手荷物検査クリップ切り出しワーカ（M5）
 *
 * monitor のキオスクAPIが退出系で `inspection_clip_jobs` に pending を作成 →
 * このワーカが自エッジ担当カメラのジョブを拾い、検査窓を NVR から切り出して
 * `baggage-clips` へアップし、`inspection_clips` を書いてジョブを done にする。
 *
 * ルーティング: ジョブは store_id/camera_id を持つ。camera_id=recorder_cameras.id が
 * このエッジ（recorders.edge_id=EDGE_ID）配下のものだけを処理する。
 *
 * 認証: getSupabase()（service_role・device_token ブートストラップで鍵同期）。
 * edge_jobs ワーカと同じ「直 Supabase ポーリング＋原子的クレーム」方式。
 *
 * 健全性・バックオフ・期限は @intereco/shared/baggage（monitor と同一契約）:
 *   - 尺が期待窓の 80% 未満 = 未確定録画の疑い → done にせず not_before を後ろへ（再試行）
 *   - deadline_at 超過 = 失敗確定（job failed / clip failed）
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../logger.js'
import { getSupabase } from '../supabase.js'
import { loadCameras } from '../cameras.js'
import { config } from '../config.js'
import { fetchWindowMp4, probeDurationSec, supportsWindowMp4 } from '../util/window-mp4.js'
import { measureNvrClockOffsetSec } from '../util/nvr-clock.js'
import { validateClipReport, nextRetryAt, isPastDeadline } from '@intereco/shared/baggage'
import type { CameraDescriptor } from '../types.js'

const POLL_MS = 15_000
const BUCKET = 'baggage-clips'

interface ClipJob {
  id: string
  session_id: string
  store_id: string
  camera_id: string | null
  window_from: string
  window_to: string
  deadline_at: string
  retry_count: number
}

/** このエッジ配下カメラの、not_before 経過済み pending を1件取得。 */
async function pollJob(supa: SupabaseClient, edgeCameraIds: string[]): Promise<ClipJob | null> {
  if (edgeCameraIds.length === 0) return null
  const { data, error } = await supa
    .from('inspection_clip_jobs')
    .select('id, session_id, store_id, camera_id, window_from, window_to, deadline_at, retry_count')
    .eq('status', 'pending')
    .lte('not_before', new Date().toISOString())
    .in('camera_id', edgeCameraIds)
    .order('not_before', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) { logger.debug({ err: error.message }, 'clip-jobs: poll skipped'); return null }
  return (data as ClipJob | null) ?? null
}

/** pending の時だけ running にする原子的クレーム（競合は null）。 */
async function claim(supa: SupabaseClient, jobId: string): Promise<boolean> {
  const { data } = await supa
    .from('inspection_clip_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  return !!data
}

/** 再試行のためジョブを pending に戻し not_before を後ろ倒し（deadline 超過なら failed）。 */
async function rescheduleOrFail(supa: SupabaseClient, job: ClipJob, tenantId: string | null, reason: string): Promise<void> {
  const now = new Date()
  if (isPastDeadline(new Date(job.deadline_at), now)) {
    await supa.from('inspection_clip_jobs')
      .update({ status: 'failed', updated_at: now.toISOString() })
      .eq('id', job.id)
    // 詳細画面が「取得失敗」を出せるようクリップ行も failed で残す（tenant 解決済みのときのみ・
    // 既に done の行は上書きしない — 重複ジョブの遅延失敗で成功記録を潰さない）。
    if (tenantId) {
      const { data: existing } = await supa
        .from('inspection_clips')
        .select('upload_status')
        .eq('session_id', job.session_id)
        .eq('camera_id', job.camera_id)
        .maybeSingle()
      if (existing?.upload_status === 'done') {
        logger.warn({ job: job.id, reason }, 'clip-jobs: past deadline (clip already done — row kept)')
        return
      }
      const { error } = await supa.from('inspection_clips').upsert(
        {
          tenant_id: tenantId,
          store_id: job.store_id,
          session_id: job.session_id,
          camera_id: job.camera_id,
          storage_path: `failed/${job.session_id}/${job.camera_id}`,
          upload_status: 'failed',
        },
        { onConflict: 'session_id,camera_id' },
      )
      if (error) logger.debug({ err: error.message }, 'clip-jobs: mark clip failed skipped')
    }
    logger.warn({ job: job.id, reason }, 'clip-jobs: past deadline → failed')
    return
  }
  const retry = job.retry_count + 1
  await supa.from('inspection_clip_jobs')
    .update({
      status: 'pending',
      retry_count: retry,
      not_before: nextRetryAt(retry, now).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', job.id)
  logger.info({ job: job.id, retry, reason }, 'clip-jobs: rescheduled')
}

/**
 * クリップのアップロード。monitor へ問い合わせて R2 presigned PUT が返れば
 * R2 直アップロード（storage_path は `r2:<key>`）、そうでなければ従来どおり
 * Supabase Storage（storage_path は素のキー）。戻り値は inspection_clips に
 * 書く storage_path（両方失敗なら null）。
 */
async function uploadClip(supa: SupabaseClient, buf: Buffer, job: ClipJob): Promise<string | null> {
  // 1) R2 presigned PUT を試す（MONITOR_URL 設定時のみ。失敗は警告してフォールバック）。
  if (config.MONITOR_URL) {
    try {
      const res = await fetch(`${config.MONITOR_URL}/api/baggage/edge/clip-upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + config.EDGE_DEVICE_TOKEN,
        },
        body: JSON.stringify({ sessionId: job.session_id, cameraId: job.camera_id }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const j = await res.json() as { mode: string; url?: string; storagePath?: string }
        if (j.mode === 'r2' && j.url && j.storagePath) {
          const put = await fetch(j.url, {
            method: 'PUT',
            headers: { 'content-type': 'video/mp4' },
            body: new Uint8Array(buf),
            // 100MB 級を細回線で上げるケースを考慮した長めのタイムアウト。
            signal: AbortSignal.timeout(180_000),
          })
          if (put.ok) return j.storagePath
          logger.warn({ job: job.id, status: put.status }, 'clip-jobs: R2 PUT failed → supabase fallback')
        }
        // mode:'supabase' は R2 未設定＝正常系のフォールバック指示。
      } else {
        logger.warn({ job: job.id, status: res.status }, 'clip-jobs: clip-upload API error → supabase fallback')
      }
    } catch (e) {
      logger.warn({ job: job.id, err: String(e) }, 'clip-jobs: R2 path error → supabase fallback')
    }
  }

  // 2) Supabase Storage（従来経路）。
  const path = `${job.session_id}/${job.camera_id}.mp4`
  const { error: upErr } = await supa.storage.from(BUCKET).upload(path, buf, {
    contentType: 'video/mp4', upsert: true,
  })
  if (upErr) {
    logger.warn({ job: job.id, err: upErr.message }, 'clip-jobs: supabase upload failed')
    return null
  }
  return path
}

async function processJob(supa: SupabaseClient, job: ClipJob, camera: CameraDescriptor, tenantId: string): Promise<void> {
  const id = `${job.session_id}-${job.camera_id}`
  let buf: Buffer
  try {
    buf = await fetchWindowMp4(camera, job.window_from, job.window_to, id)
  } catch (e) {
    await rescheduleOrFail(supa, job, tenantId, `extract: ${(e as Error).message}`)
    return
  }

  // NVR 時計と実時刻の差を切り出し時点で実測（検査時刻と映像のズレ検知用）。
  // 測定失敗やレコーダ非経由（Frigate=エッジ自身）は null のまま。切り出しは止めない。
  const clockOffsetSec = camera.recorder.vendor === 'frigate'
    ? null
    : await measureNvrClockOffsetSec(camera.recorder.vod_host ?? camera.recorder.host)

  // 健全性: 尺 80% 未満は未確定録画の疑い → done にせず後で再試行。
  const durationSec = (await probeDurationSec(buf, id)) ?? 0
  const check = validateClipReport(
    {
      windowFrom: new Date(job.window_from),
      windowTo: new Date(job.window_to),
      reportedDurationSec: durationSec,
      clockOffsetSec: 0,   // 判定は従来どおり（実測値は記録のみ・判定条件は変えない）
    },
  )
  if (!check.ok) {
    await rescheduleOrFail(supa, job, tenantId, check.reasons.join('; '))
    return
  }

  // アップロード（session/camera で決定的パス・再試行で上書き）。
  // R2（コスト是正: エグレス無料）を優先し、未設定/失敗時は Supabase へ
  // フォールバック（可用性優先 — クリップを止めない）。
  const path = await uploadClip(supa, buf, job)
  if (!path) {
    await rescheduleOrFail(supa, job, tenantId, 'upload failed (r2 and supabase)')
    return
  }

  const { error: clipErr } = await supa.from('inspection_clips').upsert(
    {
      tenant_id: tenantId,
      store_id: job.store_id,
      session_id: job.session_id,
      camera_id: job.camera_id,
      storage_path: path,
      duration_sec: durationSec,
      clock_offset_sec: clockOffsetSec,
      upload_status: 'done',
    },
    { onConflict: 'session_id,camera_id' },
  )
  if (clipErr) {
    await rescheduleOrFail(supa, job, tenantId, `clip row: ${clipErr.message}`)
    return
  }

  await supa.from('inspection_clip_jobs')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', job.id)
  logger.info({ job: job.id, bytes: buf.length, durationSec }, 'clip-jobs: done')
}

async function pollOnce(): Promise<void> {
  const supa = getSupabase()

  // 自エッジ担当カメラ（切り出し可能な vendor のみ）。
  const cameras = (await loadCameras()).filter(supportsWindowMp4)
  const byId = new Map(cameras.map((c) => [c.id, c]))
  const job = await pollJob(supa, [...byId.keys()])
  if (!job || !job.camera_id) return

  const camera = byId.get(job.camera_id)
  if (!camera) return   // 念のため（poll で絞っているので通常来ない）

  if (!(await claim(supa, job.id))) return   // 競合クレーム

  // tenant_id は clips の NOT NULL。ジョブから引く（session 経由でも可だが store で十分）。
  const { data: store } = await supa.from('stores').select('tenant_id').eq('id', job.store_id).maybeSingle()
  const tenantId = (store as { tenant_id?: string } | null)?.tenant_id
  if (!tenantId) {
    await rescheduleOrFail(supa, job, null, 'tenant not resolved')
    return
  }

  await processJob(supa, job, camera, tenantId).catch(async (e) => {
    await rescheduleOrFail(supa, job, tenantId, `process: ${(e as Error).message}`)
  })
}

/** クリップ切り出しワーカ開始（edge_jobs と同じ setInterval + busy ガード）。 */
export function startClipJobWorker(): { close: () => void } {
  let stopped = false
  let busy = false
  const run = () => {
    if (stopped || busy) return
    busy = true
    pollOnce().catch((e) => logger.debug({ err: String(e) }, 'clip-jobs: run error')).finally(() => { busy = false })
  }
  run()
  const timer = setInterval(run, POLL_MS)
  return { close() { stopped = true; clearInterval(timer) } }
}
