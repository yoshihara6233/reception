/**
 * VMS (Video Management System) API client
 *
 * OSS-VMS (VMS-cloud) 実装に合わせた API 仕様:
 *
 *   GET  /api/v1/cameras
 *     → [{ id: UUID, name, location, status, ip_address, ... }]
 *
 *   GET  /api/v1/cameras/:uuid/stream
 *     → { camera_id, hls_url: "/go2rtc/api/stream.m3u8?src=UUID", expires_at }
 *     ※ hls_url は相対パス → baseUrl を先頭に付けて絶対 URL にする
 *
 *   GET  /api/v1/recordings
 *     ?camera_id=UUID&from_dt=ISO&to_dt=ISO
 *     → [{ id, camera_id, started_at, ended_at, file_path, ... }]
 *
 *   GET  /api/v1/recordings/:id/playback-url
 *     → { url, expires_at }
 *
 * Auth: JWT Bearer token (Authorization: Bearer <token>)
 *   - POST /api/v1/auth/login → { access_token, refresh_token } で取得
 *   - vms_api_key には access_token（またはその場で login して取得する）を設定
 *
 * Camera ID 解決:
 *   store_cameras.vms_camera_id には UUID または カメラ名 を登録可能。
 *   UUID でない場合は getCameras() でリストを取得し name/ip_address でマッチング。
 *
 * サーバーサイド専用。vms_api_key をブラウザに露出しないこと。
 */

export interface VmsCamera {
  id: string          // UUID
  name: string
  location: string
  status: string      // "online" | "offline" | ...
  ip_address?: string
  is_ptz?: boolean
}

export interface VmsRecording {
  id: string          // UUID
  camera_id: string   // UUID
  camera_name?: string
  started_at: string  // ISO 8601
  ended_at?: string | null
  file_path: string
  file_size_bytes?: number
  duration_sec?: number
  codec?: string
  resolution?: string
}

export interface VmsStreamResponse {
  camera_id: string
  hls_url: string     // 相対パス "/go2rtc/api/stream.m3u8?src=UUID"
  expires_at: string  // ISO 8601
}

export interface VmsClientConfig {
  /** VMS のベース URL (例: "http://192.168.1.100:3000") */
  baseUrl: string
  /** JWT アクセストークン (POST /api/v1/auth/login で取得) */
  apiKey: string
  timeoutMs?: number
}

// UUID v4 形式かどうかチェック (簡易)
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export function createVmsClient(config: VmsClientConfig) {
  const { baseUrl, apiKey, timeoutMs = 10000 } = config

  // HTTP headers only accept ASCII (0x20-0x7E). Catch multi-byte chars early.
  if (!/^[\x20-\x7E]*$/.test(apiKey)) {
    throw new Error('VMS API Key には半角英数字・記号のみ使用できます（日本語不可）')
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`VMS ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
      }

      return res.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }

  /** HLS の相対 URL を絶対 URL に変換する */
  function toAbsoluteUrl(hlsUrl: string): string {
    if (hlsUrl.startsWith('http://') || hlsUrl.startsWith('https://')) return hlsUrl
    // 相対パスの場合は baseUrl を先頭に付ける
    return `${baseUrl}${hlsUrl.startsWith('/') ? '' : '/'}${hlsUrl}`
  }

  return {
    /** GET /api/v1/cameras — カメラ一覧 (常に配列を返す) */
    async getCameras(): Promise<VmsCamera[]> {
      const raw = await request<unknown>('GET', '/api/v1/cameras')
      // FastAPI は配列を直接返すが、念のため防御
      if (Array.isArray(raw)) return raw as VmsCamera[]
      // { cameras: [...] } 形式で返る場合
      if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).cameras)) {
        return (raw as Record<string, unknown>).cameras as VmsCamera[]
      }
      throw new Error(`VMS /api/v1/cameras の応答が配列ではありません: ${JSON.stringify(raw).slice(0, 100)}`)
    },

    /**
     * ライブ HLS URL を取得する。
     *
     * OSS-VMS の仕様:
     *   GET /api/v1/cameras/:name/stream
     *     → { hls_url: "https://vms.../proxy/frigate/api/go2rtc/api/stream.m3u8?src=...&access_token=..." }
     *     go2rtc ライブ HLS。遅延 5〜15秒。
     *     hls_url はブラウザから直接再生可能（HMAC access_token で認証済み）
     *
     * @param cameraId  VMS カメラ名 (OSS-VMS/Frigate) または UUID
     * @returns  hls_url: 直接 HLS.js に渡せる絶対 URL (access_token 付き)
     */
    async getLiveStream(cameraId: string): Promise<{ hls_url: string; expires_at: string }> {
      // go2rtc ライブ HLS: カメラ名 / UUID いずれも /api/v1/cameras/:id/stream で統一
      const res = await request<{ hls_url: string; expires_at: string | null }>(
        'GET', `/api/v1/cameras/${encodeURIComponent(cameraId)}/stream`
      )
      return {
        hls_url:    res.hls_url,
        expires_at: res.expires_at ?? new Date(Date.now() + 3600_000).toISOString(),
      }
    },

    /**
     * カメラ名 / IP / UUID から VMS の UUID を解決する。
     * vms_camera_id が UUID 形式でない場合に使用。
     * @param idOrName  UUID, カメラ名, または IP アドレス
     * @returns  VMS カメラ UUID (見つからなければ null)
     */
    async resolveCameraId(idOrName: string): Promise<string | null> {
      if (isUuid(idOrName)) return idOrName
      // UUID でなければカメラ一覧で name / ip_address を検索
      // getCameras() を経由することで防御コードが効く
      const raw = await request<unknown>('GET', '/api/v1/cameras')
      const cameras: VmsCamera[] = Array.isArray(raw) ? raw as VmsCamera[]
        : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).cameras))
          ? (raw as Record<string, unknown>).cameras as VmsCamera[]
          : []
      const q = idOrName.trim()
      const match = cameras.find(
        c => (c.id ?? '').trim() === q || (c.name ?? '').trim() === q || (c.ip_address ? c.ip_address.trim() === q : false)
      )
      return match?.id ?? null
    },

    /**
     * VOD HLS URL を取得する（録画再生用）。
     *
     * OSS-VMS: GET /api/v1/recordings?camera={name}&from={unix}&to={unix}
     *   → { hls_url: "https://vms.../proxy/frigate/vod/.../index.m3u8?access_token=..." }
     *
     * @param cameraId  VMS カメラ名（またはUUID — 名前ベースで直接使用）
     * @param fromIso   開始時刻 (ISO 8601)
     * @param toIso     終了時刻 (ISO 8601)
     */
    async getVodUrl(
      cameraId: string,
      fromIso: string,
      toIso?: string,
    ): Promise<{ hls_url: string; expires_at: string }> {
      const from = Math.floor(new Date(fromIso).getTime() / 1000)
      const to   = toIso
        ? Math.floor(new Date(toIso).getTime() / 1000)
        : from + 3600  // デフォルト 1 時間
      const qs = new URLSearchParams({
        camera: cameraId,
        from:   String(from),
        to:     String(to),
      })
      const res = await request<{ hls_url: string; from_unix: number; to_unix: number }>(
        'GET', `/api/v1/recordings?${qs}`
      )
      return {
        hls_url:    res.hls_url,
        expires_at: new Date(to * 1000).toISOString(),
      }
    },

    /**
     * @deprecated OSS-VMS は /api/v1/recordings/:id/playback-url を提供しない。
     * getVodUrl() を使用してください。
     */
    getRecordings(_params: {
      cameraId: string
      fromDt?: string
      toDt?: string
      pageSize?: number
    }): Promise<VmsRecording[]> {
      return Promise.resolve([])
    },

    /**
     * @deprecated OSS-VMS は /api/v1/recordings/:id/playback-url を提供しない。
     * getVodUrl() を使用してください。
     */
    getPlaybackUrl(_recordingId: string): Promise<{ url: string; expires_at: string }> {
      return Promise.resolve({ url: '', expires_at: '' })
    },
  }
}

/** ストア設定から VMS クライアントを生成 (未設定なら null) */
export function createVmsClientFromSettings(settings: {
  vms_url?: string | null
  vms_api_key?: string | null
  vms_enabled?: boolean | null
} | null): ReturnType<typeof createVmsClient> | null {
  if (!settings?.vms_enabled) return null
  if (!settings.vms_url || !settings.vms_api_key) return null
  return createVmsClient({ baseUrl: settings.vms_url, apiKey: settings.vms_api_key })
}
