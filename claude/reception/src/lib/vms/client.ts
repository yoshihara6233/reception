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
     * GET /api/v1/cameras/:uuid/stream — ライブ HLS URL を取得
     * @param cameraUuid  VMS カメラ UUID (UUID 形式)
     * @returns  絶対 URL に変換済みの hls_url
     */
    async getLiveStream(cameraUuid: string): Promise<{ hls_url: string; expires_at: string }> {
      const res = await request<VmsStreamResponse>('GET', `/api/v1/cameras/${encodeURIComponent(cameraUuid)}/stream`)
      return {
        hls_url:    toAbsoluteUrl(res.hls_url),
        expires_at: res.expires_at,
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
        c => c.id.trim() === q || c.name.trim() === q || (c.ip_address && c.ip_address.trim() === q)
      )
      return match?.id ?? null
    },

    /**
     * GET /api/v1/recordings — 録画一覧 (カメラUUID + 期間でフィルタ)
     */
    getRecordings(params: {
      cameraId: string     // UUID
      fromDt?: string      // ISO 8601
      toDt?: string        // ISO 8601
      pageSize?: number
    }): Promise<VmsRecording[]> {
      const qs = new URLSearchParams({ camera_id: params.cameraId })
      if (params.fromDt)   qs.set('from_dt',   params.fromDt)
      if (params.toDt)     qs.set('to_dt',     params.toDt)
      if (params.pageSize) qs.set('page_size', String(params.pageSize))
      return request<VmsRecording[]>('GET', `/api/v1/recordings?${qs}`)
    },

    /**
     * GET /api/v1/recordings/:id/playback-url — 署名付き再生 URL
     */
    async getPlaybackUrl(recordingId: string): Promise<{ url: string; expires_at: string }> {
      const res = await request<{ url: string; expires_at: string }>(
        'GET', `/api/v1/recordings/${recordingId}/playback-url`
      )
      return {
        url:        toAbsoluteUrl(res.url),
        expires_at: res.expires_at,
      }
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
