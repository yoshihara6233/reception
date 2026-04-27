/**
 * VMS (Video Management System) API client
 *
 * 最終 API 仕様:
 *   GET  /api/v1/cameras
 *   GET  /api/v1/recordings?camera=X&from=ISO&to=ISO   (HLS URL 取得、DB 保存なし)
 *   POST /api/v1/inspections                           → { id, hls_url }
 *   PATCH /api/v1/inspections/:id                      (ended_at 更新)
 *   GET  /api/v1/inspections/:id
 *   GET  /api/v1/inspections/:id/snapshot              (img src 直接指定可)
 *
 * Auth: Bearer token (Authorization ヘッダ)
 * HLS URL: 追加ヘッダー不要 — <video> / HLS.js から直接アクセス可
 *
 * サーバーサイド専用。vmsApiKey をブラウザに露出しないこと。
 */

export interface VmsCamera {
  id: string
  name: string
  location?: string
  status?: string
}

export interface VmsRecording {
  camera: string
  hls_url: string
  from?: string
  to?: string
}

export interface VmsInspection {
  id: string
  hls_url: string
  camera?: string
  started_at?: string
  ended_at?: string | null
  subject_ref?: string
  status?: string
}

export interface VmsClientConfig {
  /** VMS のベース URL (例: "https://vms.your-domain.com" または "http://192.168.1.100:8080") */
  baseUrl: string
  /** Bearer トークン */
  apiKey: string
  timeoutMs?: number
}

export function createVmsClient(config: VmsClientConfig) {
  const { baseUrl, apiKey, timeoutMs = 10000 } = config

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
        throw new Error(`VMS ${method} ${path} → ${res.status}: ${text}`)
      }

      return res.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** GET /api/v1/cameras — カメラ一覧 */
    getCameras(): Promise<VmsCamera[]> {
      return request<VmsCamera[]>('GET', '/api/v1/cameras')
    },

    /** GET /api/v1/recordings?camera=X&from=ISO&to=ISO — HLS URL 取得 */
    getRecordings(params: { camera: string; from?: string; to?: string }): Promise<VmsRecording[]> {
      const qs = new URLSearchParams({ camera: params.camera })
      if (params.from) qs.set('from', params.from)
      if (params.to)   qs.set('to',   params.to)
      return request<VmsRecording[]>('GET', `/api/v1/recordings?${qs}`)
    },

    /**
     * POST /api/v1/inspections — 検査開始
     * @param camera     カメラ ID (例: "camera_01")
     * @param startedAt  ISO 8601 開始時刻
     * @param subjectRef 参照キー (例: CHK-001, visitId など)
     */
    createInspection(params: {
      camera: string
      startedAt?: string
      subjectRef?: string
    }): Promise<VmsInspection> {
      return request<VmsInspection>('POST', '/api/v1/inspections', {
        camera:      params.camera,
        started_at:  params.startedAt ?? new Date().toISOString(),
        subject_ref: params.subjectRef,
      })
    },

    /**
     * PATCH /api/v1/inspections/:id — 終了時刻を更新
     */
    endInspection(inspectionId: string, endedAt?: string): Promise<VmsInspection> {
      return request<VmsInspection>('PATCH', `/api/v1/inspections/${inspectionId}`, {
        ended_at: endedAt ?? new Date().toISOString(),
      })
    },

    /** GET /api/v1/inspections/:id — 検査記録と URL 再取得 */
    getInspection(inspectionId: string): Promise<VmsInspection> {
      return request<VmsInspection>('GET', `/api/v1/inspections/${inspectionId}`)
    },

    /**
     * GET /api/v1/inspections/:id/snapshot
     * img src に直接指定可能な URL を返す。
     * 実際の画像取得はブラウザが直接 VMS に行う（認証不要な静的リソース想定）
     */
    snapshotUrl(inspectionId: string): string {
      return `${baseUrl}/api/v1/inspections/${inspectionId}/snapshot`
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
