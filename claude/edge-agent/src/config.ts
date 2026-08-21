import 'dotenv/config'
import { z } from 'zod'

const Env = z.object({
  SUPABASE_URL:              z.string().url(),
  SUPABASE_ANON_KEY:         z.string().min(20),
  // Phase B4: スコープ運用（EDGE_SCOPED_DB=true）に載ったエッジでは **不要**。
  // .env から消せるようにするため optional にした（消せなければ「bootstrap が
  // 鍵を返さない」ようにしても、エッジのディスクにはマスター鍵が残り続ける）。
  // 非スコープ運用では従来どおり必須（下の superRefine で強制）。
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  EDGE_ID:                   z.string().uuid(),
  EDGE_DEVICE_TOKEN:         z.string().min(8),

  // 鍵ローテ無停止同期(pull型): 設定すると edge が device_token 認証で monitor から
  // 現行 service key を取得し、メモリ上の鍵を差し替える(.env手動編集が不要に)。
  // 未設定なら従来通り SUPABASE_SERVICE_ROLE_KEY(.env)をそのまま使う。
  MONITOR_URL:               z.string().url().optional(),
  BOOTSTRAP_INTERVAL_MS:     z.coerce.number().default(300_000),

  // エッジ専用スコープ鍵化 Phase B1: edge_jobs を service_role ではなく
  // bootstrap 発行の短命スコープトークン(authenticated/RLS)で叩く。
  // ロールアウト安全のため既定 false。本番で migration+provisioning を確認後、
  // エッジ .env に EDGE_SCOPED_JOBS=true を設定して有効化する。
  // 有効でも scoped トークン未取得時はそのtickをスキップ(service_roleへは落ちない)。
  // z.coerce.boolean は "false" も true になる罠があるため明示パース('true'/'1'のみ真)。
  EDGE_SCOPED_JOBS:          z.string().optional()
                              .transform((v) => v === 'true' || v === '1'),

  // エッジ専用スコープ鍵化 Phase B3: **全ての** DB/Storage アクセスを短命スコープ
  // トークンで行う（service_role をエッジの実行経路から外す）。B2 の RLS が
  // 本番に入っていることが前提。既定 false ＝ 従来どおり service_role。
  // 有効時はトークンが無い/期限切れでも service_role には落ちない（fail-closed）。
  // その状態の要求は 401 になり、heartbeat のエラー処理が bootstrap を叩いて復帰する。
  EDGE_SCOPED_DB:            z.string().optional()
                              .transform((v) => v === 'true' || v === '1'),

  // LiveKit endpoint URL — informational/diagnostic only since the F3 Ingress
  // migration. The edge no longer constructs WHIP URLs from this; the cloud
  // mints a per-session Ingress URL and passes it in livekit_whip_url. Kept
  // optional so existing .env files keep validating cleanly.
  LIVEKIT_URL:               z.string().url().optional(),

  // Supabase Storage の 1 ファイル上限。プロジェクト全体の設定（既定 50MB）に
  // 合わせる。少し余裕を残すのは、MP4 のコンテナ overhead と multipart 分で
  // 実測が見積りを数 % 上回ることがあるため。上限を上げたらここも上げる。
  VOD_MAX_UPLOAD_BYTES:   z.coerce.number().int().positive().default(45 * 1024 * 1024),

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

  // 自律OTA（docs/edge-ota-design.md）。EDGE_ROOT 未設定なら OTA 無効＝no-op で安全に空振り
  // （ローカル/CI・旧レイアウト機を壊さない）。設定時のみ desired 版に追従する。
  EDGE_ROOT:              z.string().optional(),
  // 再起動する systemd ユニット（NOPASSWD sudoers 前提）。
  EDGE_AGENT_UNIT:        z.string().default('intereco-edge'),
  CLOUDFLARED_UNIT:       z.string().default('cloudflared-intereco'),
  // 健全とみなす最小安定時間・heartbeat 到達猶予（ms）。
  OTA_MIN_STABLE_MS:      z.coerce.number().default(90_000),
  OTA_HEARTBEAT_GRACE_MS: z.coerce.number().default(90_000),

  // VOD: if ffmpeg spawns but no first frame is published within this window,
  // kill it and surface onError so the browser shows "再生できません" instead of
  // spinning forever (T2 / external review "spawn-but-no-frames").
  VOD_FIRST_FRAME_TIMEOUT_MS: z.coerce.number().default(10_000),

  // Host port for Frigate's HTTP API (clip.mp4 export). Frigate exposes it on
  // 5000 inside the container; the default assumes Docker maps 5000→5000 on
  // the host. macOS users may need to remap (e.g. 5050→5000) because the
  // built-in AirPlay Receiver also binds to host:5000 and silently wins.
  FRIGATE_API_PORT: z.coerce.number().default(5000),

  // 発報受け口（Phase B PB5）: i-PRO/NVR の HTTP アラーム通知・外部Webhook を LAN で受ける
  // ローカル HTTP リスナーのポート。0（既定）＝無効。設定すると 0.0.0.0:<port> で待受け、
  // 受信時に該当カメラを撮影して cloud /api/alarms/ingest へ中継する（要 MONITOR_URL）。
  ALARM_LISTEN_PORT: z.coerce.number().default(0),

  // 発報受け口の共有トークン。設定すると /alarm は ?token=<値>（または X-Alarm-Token ヘッダ）の
  // 一致を必須にし、不一致は 401 で破棄する（LAN 内のなりすまし発報対策）。カメラ/NVR の
  // HTTP 通知先 URL に &token=... を含めて配布する。未設定＝検証なし（従来互換・起動時 warn）。
  ALARM_SHARED_TOKEN: z.string().trim().default(''),

  // 発報前後スナップ（PB7）の録画フラッシュ猶予（ms）。**発報前（-5秒）の録画抽出のみ**に適用し、
  // target+この時間だけ待ってから抽出する（NVR が該当秒を VOD 化する猶予）。BCP 実機で 60s
  // 必要だったため踏襲。小さくすると未フラッシュで latest フォールバックしやすくなる。
  // 発生時以降はライブ即時取得のためこの猶予は掛からない。
  ALARM_FRAME_SETTLE_MS: z.coerce.number().default(60_000),
}).superRefine((v, ctx) => {
  // スコープ運用でない限り service_role は必須。ここを緩めたままにすると
  // 「鍵が無いのに非スコープ経路が走って実行時に落ちる」状態を許してしまう。
  if (!v.EDGE_SCOPED_DB && !v.SUPABASE_SERVICE_ROLE_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SUPABASE_SERVICE_ROLE_KEY'],
      message: 'EDGE_SCOPED_DB=true のとき以外は必須です（省略できるのはスコープ運用のみ）',
    })
  }
})

export const config = Env.parse(process.env)
export type Config = z.infer<typeof Env>
