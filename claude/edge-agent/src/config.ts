import 'dotenv/config'
import { z } from 'zod'

const Env = z.object({
  SUPABASE_URL:              z.string().url(),
  SUPABASE_ANON_KEY:         z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  EDGE_ID:                   z.string().uuid(),
  EDGE_DEVICE_TOKEN:         z.string().min(8),

  // 鍵ローテ無停止同期(pull型): 設定すると edge が device_token 認証で monitor から
  // 現行 service key を取得し、メモリ上の鍵を差し替える(.env手動編集が不要に)。
  // 未設定なら従来通り SUPABASE_SERVICE_ROLE_KEY(.env)をそのまま使う。
  MONITOR_URL:               z.string().url().optional(),
  BOOTSTRAP_INTERVAL_MS:     z.coerce.number().default(300_000),

  // LiveKit endpoint URL — informational/diagnostic only since the F3 Ingress
  // migration. The edge no longer constructs WHIP URLs from this; the cloud
  // mints a per-session Ingress URL and passes it in livekit_whip_url. Kept
  // optional so existing .env files keep validating cleanly.
  LIVEKIT_URL:               z.string().url().optional(),

  FFMPEG_BIN:             z.string().default('/usr/bin/ffmpeg'),
  FFPROBE_BIN:            z.string().default('/usr/bin/ffprobe'),
  GO2RTC_BIN:             z.string().default('/usr/local/bin/go2rtc'),
  // go2rtc REST API (ローカル・診断用)。
  GO2RTC_API:             z.string().default('http://localhost:1984'),
  // エッジが生成・書き出す go2rtc 設定ファイル。
  GO2RTC_CONFIG:          z.string().default('/home/intereco/go2rtc.yaml'),
  // 設定変更時に再起動する systemd サービス名（NOPASSWD sudoers 前提）。
  GO2RTC_SERVICE:         z.string().default('intereco-go2rtc'),
  // go2rtc 内部 RTSP の listen（Frigate の 8554/8555 と衝突回避）。
  GO2RTC_RTSP_LISTEN:     z.string().default(':18554'),
  // H.265→H.264 変換に使う VAAPI デバイス。空文字ならソフト変換にフォールバック。
  GO2RTC_VAAPI_DEVICE:    z.string().default('/dev/dri/renderD128'),
  // go2rtc 自動同期の周期(ms)。DB変更/サービス状態に追従するため定期再同期。
  GO2RTC_SYNC_INTERVAL_MS: z.coerce.number().default(300_000),
  TMP_DIR:                z.string().default('/var/tmp/edge-agent'),

  GRID_FPS:               z.coerce.number().default(0.5),
  GRID_WIDTH:             z.coerce.number().default(1280),
  GRID_HEIGHT:            z.coerce.number().default(720),
  GRID_JPEG_QUALITY:      z.coerce.number().min(2).max(31).default(6),

  HEARTBEAT_INTERVAL_MS:  z.coerce.number().default(60_000),

  // VOD: if ffmpeg spawns but no first frame is published within this window,
  // kill it and surface onError so the browser shows "再生できません" instead of
  // spinning forever (T2 / external review "spawn-but-no-frames").
  VOD_FIRST_FRAME_TIMEOUT_MS: z.coerce.number().default(10_000),

  // Host port for Frigate's HTTP API (clip.mp4 export). Frigate exposes it on
  // 5000 inside the container; the default assumes Docker maps 5000→5000 on
  // the host. macOS users may need to remap (e.g. 5050→5000) because the
  // built-in AirPlay Receiver also binds to host:5000 and silently wins.
  FRIGATE_API_PORT: z.coerce.number().default(5000),
})

export const config = Env.parse(process.env)
export type Config = z.infer<typeof Env>
