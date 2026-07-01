/**
 * Edge Agent entry point.
 *
 * Lifecycle:
 *   1. Connect to Supabase, mark this device "idle".
 *   2. Subscribe to the command channel.
 *   3. Send a periodic heartbeat so the cloud knows we're alive.
 *   4. Graceful shutdown on SIGINT/SIGTERM: stop active mode, mark "offline".
 */
import { config } from './config.js'
import { logger } from './logger.js'
import { loadCameras } from './cameras.js'
import { startGo2rtcSync } from './go2rtc/sync.js'
import { refreshSupabaseKey, startKeySync } from './supabase.js'
import { subscribeCommands } from './realtime.js'
import { startEdgeJobWorker } from './workers/edge-jobs.js'
import { StateMachine } from './state-machine.js'
import { heartbeat } from './upload/storage.js'
import { startWhipProxy, wrapWhip } from './whip-proxy.js'
import { captureCameraJpeg } from './security/snapshot.js'
import { startAlarmListener } from './alarm/listener.js'
import { verifyOnBoot, type RunnerDeps } from './ota/runner.js'
import { healthProbe } from './ota/signal.js'

const fsm = new StateMachine()

async function main() {
  logger.info({ edge_id: config.EDGE_ID }, 'edge agent starting')
  // 鍵ローテ無停止同期: 起動時に monitor から現行 service key を取得し、以後も定期同期。
  // MONITOR_URL 未設定なら no-op（.env キー運用）。
  await refreshSupabaseKey()
  startKeySync()

  // 自律OTA: 直前に新版へ切替えて再起動した場合、健全性を確認して known-good 昇格 or
  // ロールバックする（pending_verify が無い通常起動は即 no-op）。heartbeat を流しながら
  // 背後で検証するため非ブロッキングで起動する。EDGE_ROOT 未設定なら no-op。
  const otaDeps: RunnerDeps = {
    edgeRoot: config.EDGE_ROOT,
    agentUnit: config.EDGE_AGENT_UNIT,
    minStableMs: config.OTA_MIN_STABLE_MS,
    heartbeatGraceMs: config.OTA_HEARTBEAT_GRACE_MS,
  }
  void verifyOnBoot(otaDeps, async () => healthProbe(config.OTA_MIN_STABLE_MS))
    .catch((e) => logger.warn({ err: String(e) }, 'ota: verifyOnBoot failed'))

  // F3+: localhost WHIP proxy. Strips TCP ICE candidates from LiveKit Cloud's
  // SDP answer so ffmpeg 8.1's WHIP muxer (which errors on the first TCP
  // candidate) can complete the handshake on the UDP candidates that follow.
  const whipProxy = await startWhipProxy()
  await fsm.toIdle()

  // go2rtc 高画質ライブ: 担当カメラの stream を go2rtc に自動登録（起動時+定期）。
  // 視聴は monitor のHLS認証プロキシ経由。手動 go2rtc.yaml 編集は不要。
  startGo2rtcSync(loadCameras)

  // 登録ウィザード支援: 本部からの ONVIF探索 / 接続テスト ジョブを処理（pending をポーリング）。
  const jobs = startEdgeJobWorker()

  // 発報受け口: i-PRO/NVR の HTTP アラーム通知・外部 Webhook を LAN で受けて中継する
  // （ALARM_LISTEN_PORT>0 かつ MONITOR_URL 設定時のみ起動。それ以外は no-op）。
  const alarmListener = startAlarmListener(loadCameras)

  const rt = subscribeCommands(async (cmd) => {
    try {
      switch (cmd.action) {
        case 'start_grid': {
          const cams = await loadCameras()
          if (!cams.length) return logger.warn('no cameras configured')
          await fsm.toGrid(cams)
          break
        }
        case 'stop_grid':
        case 'stop_stream': {
          await fsm.toIdle()
          break
        }
        case 'start_live': {
          const cams = await loadCameras()
          const cam = cams.find((c) => c.id === cmd.camera_id)
          if (!cam) return logger.warn({ camera_id: cmd.camera_id }, 'unknown camera')
          await fsm.toLive({ camera: cam })
          break
        }
        case 'start_vod': {
          // F77 / Phase 8.4-B — VOD is now Storage Direct: edge fetches the
          // recorded segment from Frigate and uploads it to the vod-clips
          // bucket; the browser plays via HTML5 <video> with a signed URL.
          // LiveKit WHIP path is GONE.
          const cams = await loadCameras()
          const cam = cams.find((c) => c.id === cmd.camera_id)
          if (!cam) return logger.warn({ camera_id: cmd.camera_id }, 'unknown camera')

          // VOD 対応: Frigate / onvif-generic+NVR / i-pro-nvr(レコーダ経由)。
          const vodOk = cam.recorder.vendor === 'frigate'
            || cam.recorder.vendor === 'i-pro-nvr'
            || (cam.recorder.vendor === 'onvif-generic' && !!cam.recorder.vod_host)
          if (!vodOk) {
            logger.warn(
              { camera_id: cmd.camera_id, vendor: cam.recorder.vendor },
              'start_vod: VOD unsupported for this camera (frigate / onvif-generic+NVR only) — skipping',
            )
            return
          }

          if (!cmd.clip_id) {
            // The /api/vod route always creates a vod_clips row first and
            // forwards its id. A start_vod without clip_id is stale (pre-F77
            // browser code, replayed command, etc.) — drop it.
            logger.warn({ camera_id: cmd.camera_id }, 'start_vod: missing clip_id — skipping')
            return
          }

          await fsm.toVod({
            camera:  cam,
            fromIso: cmd.from_iso,
            toIso:   cmd.to_iso,
            clipId:  cmd.clip_id,
            // F77: upload completion / failure both return the edge to idle.
            // The browser learns the result via /api/vod/<clipId>/status, not
            // a LiveKit track event.
            onEnded: () => { void fsm.toIdle() },
            onError: (reason) => {
              logger.warn({ reason, clipId: cmd.clip_id }, 'vod: upload error')
              void fsm.toIdle()
            },
          })
          break
        }
        case 'capture_snapshot': {
          // SECURITY 巡回: 指定カメラのスナップを取り ingest_url
          // (= /api/security/patrol/ingest) に multipart で POST。
          //
          // 取得は captureCameraJpeg が「Frigate → ONVIF直接 → go2rtc」の順で最速経路を選ぶ。
          // 並列＋タイムアウト: カメラ毎に並列化し各撮影を CAPTURE_TIMEOUT_MS で打ち切る
          // （遅い/不通の 1 台が他のカメラをブロックしない）。
          const cams = await loadCameras()
          const CAPTURE_TIMEOUT_MS = 25_000
          await Promise.all(cmd.camera_ids.map(async (camId) => {
            const cam = cams.find((c) => c.id === camId)
            if (!cam) {
              logger.warn({ cam_id: camId }, 'capture_snapshot: unknown camera')
              return
            }
            const ac = new AbortController()
            const timer = setTimeout(() => ac.abort(), CAPTURE_TIMEOUT_MS)
            const t0 = Date.now()
            try {
              const { bytes, via } = await captureCameraJpeg(cam, ac.signal)
              const form = new FormData()
              form.set('run_id',    cmd.run_id)
              form.set('camera_id', camId)
              form.set('image', new Blob([bytes], { type: 'image/jpeg' }), 'snapshot.jpg')
              const ingestRes = await fetch(cmd.ingest_url, {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + config.EDGE_DEVICE_TOKEN },
                body: form,
                signal: ac.signal,
              })
              if (!ingestRes.ok) {
                logger.warn(
                  { cam_id: camId, status: ingestRes.status, via },
                  'capture_snapshot: ingest rejected',
                )
              } else {
                logger.info({ cam_id: camId, bytes: bytes.byteLength, ms: Date.now() - t0, via }, 'capture_snapshot: ingest ok')
              }
            } catch (e) {
              const aborted = ac.signal.aborted
              logger.warn({ err: String(e), cam_id: camId, ms: Date.now() - t0, aborted }, 'capture_snapshot: failed')
            } finally {
              clearTimeout(timer)
            }
          }))
          break
        }
        case 'start_bcp_capture': {
          const cams = await loadCameras()
          await fsm.toBcp(
            { eventId: cmd.eventId, clips: cmd.clips, clipFrom: cmd.clipFrom, clipTo: cmd.clipTo, offsets: cmd.offsets },
            cams,
          )
          break
        }
        case 'reboot': {
          logger.warn('reboot requested')
          await fsm.toIdle()
          process.exit(0)
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'command handling failed')
      await fsm.toError(String((e as Error).message ?? e))
    }
  })

  const hb = setInterval(() => {
    heartbeat(fsm.current()).catch(() => {})
  }, config.HEARTBEAT_INTERVAL_MS)

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutdown')
    clearInterval(hb)
    await rt.close()
    jobs.close()
    alarmListener.close()
    await fsm.toIdle()
    await whipProxy.stop().catch(() => {})
    await heartbeat('offline')
    process.exit(0)
  }
  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((e) => {
  logger.fatal({ err: e }, 'fatal startup error')
  process.exit(1)
})
