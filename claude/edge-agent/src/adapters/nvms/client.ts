/**
 * NVMS (自社オンプレ VMS) REST クライアント。
 *
 * 認証は API キーのみ（`Authorization: Bearer nvms_...`）。recorders の
 * 保存先は password_enc（既存の暗号化経路をそのまま使う）で、username は
 * 使わない。**キーは operator 権限で発行すること** — 範囲エクスポート
 * （録画クリップ）が operator 以上のため。閲覧だけなら viewer で足りるが、
 * その構成では VOD・BCP が 403 になる。
 *
 * 窓口は 1 ノードで足りる: NVMS クラスタは他ノードのカメラ媒体を所有ノードへ
 * リバースプロキシするため、どのノードに投げても全カメラが取れる。
 *
 * ── スナップショットの重要仕様（NVMS openapi.yaml より）──────────────────
 * `/cameras/{id}/snapshot` は**オンデマンド開始**。要求した時点でそのカメラの
 * 1fps 出力が始まり、まだ 1 枚も無ければ 404 を返す。数秒後の再取得で得られる。
 * grid / live は毎秒のループなので、**初回 404 は失敗ではなく「起動中」**。
 * 呼び出し側は前フレーム保持（LAST_FRAME）で暗転を防いでいる。
 */
import { createHash } from 'node:crypto'
import { logger } from '../../logger.js'

export interface NvmsOpts {
  /** 例: 'http://192.168.10.5:8080'（nvmsEndpoint で組み立てる） */
  endpoint:  string
  /** API キー（nvms_...）。ログに出さない。 */
  apiKey:    string
  timeoutMs?: number
}

/**
 * recorder.host（'192.168.10.5' / '192.168.10.5:8080' / 'https://nvms.local'）
 * から接続先 URL を作る。スキーム付きはそのまま。無ければ http:// を付け、
 * ポートも無ければ NVMS 既定の 8080 を補う。LAN 内は平文 HTTP が既定
 * （i-pro-nvr の https 既定とは違う点に注意）。
 */
export function nvmsEndpoint(host: string): string {
  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host.replace(/\/+$/, '')
  }
  const withPort = /:[0-9]+$/.test(host) ? host : `${host}:8080`
  return `http://${withPort}`
}

function headers(o: NvmsOpts): Record<string, string> {
  return { Authorization: `Bearer ${o.apiKey}` }
}

/**
 * 現在の静止画 (JPEG) を 1 枚取得。
 * 404 は「スナップショット出力の起動中 or カメラ不存在」— メッセージで区別できる
 * ようにし、呼び出し側のループが次周期で再試行する。
 */
export async function fetchNvmsSnapshot(o: NvmsOpts, cameraId: number): Promise<Buffer> {
  const url = `${o.endpoint}/api/v1/cameras/${cameraId}/snapshot`
  const res = await fetch(url, {
    headers: headers(o),
    signal:  AbortSignal.timeout(o.timeoutMs ?? 8_000),
  })
  if (res.status === 404) {
    // オンデマンド仕様: この要求自体が出力開始のトリガーになっている。
    throw new Error(`nvms snapshot 404 (camera ${cameraId}: 出力起動中かカメラ不存在。次周期で再試行)`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`nvms snapshot ${res.status}: API キーが無効か権限不足`)
  }
  if (!res.ok) throw new Error(`nvms snapshot HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 512) throw new Error(`nvms snapshot too small (${buf.length} bytes)`)
  return buf
}

/** 取得失敗を、現場が次に動ける文にする（i-PRO nvr-vod と同じ流儀）。 */
export function nvmsExportStatusMessage(status: number, from: Date): string {
  const jst = new Date(from.getTime() + 9 * 3600_000)
  const stamp = `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')} `
    + `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
  if (status === 404) {
    return `${stamp} の録画が見つかりません。NVMS 側の保持期間を過ぎているか、その時間帯は録画されていない可能性があります`
  }
  if (status === 401 || status === 403) {
    return 'NVMS の API キーが無効か、権限が不足しています（範囲エクスポートには operator 以上のキーが必要です）'
  }
  return `NVMS がエラーを返しました (HTTP ${status})`
}

/**
 * 範囲エクスポート（結合+トリム済みの標準 MP4・NVMS 側上限 60 分）を取得。
 * NVMS はレスポンスヘッダ `X-Content-SHA256` にチェックサムを載せる。
 * 受信後に自前で計算して**照合し、ズレていれば捨てる**（転送破損をアップロード
 * 前に検知する。ヘッダが無い旧版 NVMS では照合をスキップ）。
 */
export async function downloadNvmsExportMp4(
  o: NvmsOpts,
  cameraId: number,
  from: Date,
  to: Date,
): Promise<Buffer> {
  const qs = new URLSearchParams({
    camera_id: String(cameraId),
    from:      from.toISOString(),
    to:        to.toISOString(),
  })
  const url = `${o.endpoint}/api/v1/recordings/export?${qs}`
  const res = await fetch(url, {
    headers: headers(o),
    signal:  AbortSignal.timeout(o.timeoutMs ?? 120_000),
  })
  if (!res.ok) throw new Error(nvmsExportStatusMessage(res.status, from))

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1024) throw new Error(`empty_clip (bytes=${buf.length})`)

  const want = res.headers.get('x-content-sha256')
  if (want) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got.toLowerCase() !== want.toLowerCase()) {
      throw new Error(`nvms export checksum mismatch (期待 ${want.slice(0, 12)}… 実際 ${got.slice(0, 12)}…) — 転送破損の可能性`)
    }
  }
  logger.info({ cameraId, bytes: buf.length, sha256: want ? 'verified' : 'absent' }, 'nvms: export downloaded')
  return buf
}
