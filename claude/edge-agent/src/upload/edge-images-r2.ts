/**
 * ライブ画像（grid / snapshot）の R2 直アップロード。
 *
 * 背景: 従来は Supabase Storage へ上げ、ブラウザも毎フレーム Supabase から
 * 取り直していたため課金エグレスが視聴1時間あたり約0.5GB発生していた
 * （2026-08-03 に Free 上限 5GB に対し 11.4GB 超過）。R2 はエグレス無料。
 *
 * 設計:
 *  - monitor の /api/edges/<id>/image-upload-url から presigned PUT を受け取る。
 *    キーは固定（grid.jpg / snapshot.jpg を上書き）なので、TTL(1h)の間は
 *    同じ URL を再利用でき、毎フレームの presign 往復は発生しない。
 *  - 取得できない／R2 未設定／PUT 失敗 のいずれでも false を返し、
 *    呼び出し側は従来の Supabase 経路へフォールバックする（映像を止めない）。
 */
import { config } from '../config.js'
import { logger } from '../logger.js'

interface PresignBundle {
  grid: string | null
  snapshots: Record<string, string>
  expiresAt: number
}

/** presign の再取得マージン（期限ぎりぎりの PUT 失敗を避ける）。 */
const RENEW_MARGIN_MS = 5 * 60_000
/** 取得失敗時のバックオフ（monitor 未対応版なら毎フレーム叩かない）。 */
const RETRY_AFTER_MS = 5 * 60_000

let bundle: PresignBundle | null = null
let nextAttemptAt = 0
let inFlight: Promise<PresignBundle | null> | null = null

/** テスト用: モジュール状態を初期化する。 */
export function _resetPresignCache(): void {
  bundle = null
  nextAttemptAt = 0
  inFlight = null
}

function monitorUrl(): string | null {
  return config.MONITOR_URL || null
}

async function fetchPresign(cameraIds: string[]): Promise<PresignBundle | null> {
  const base = monitorUrl()
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/edges/${config.EDGE_ID}/image-upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.EDGE_DEVICE_TOKEN}`,
      },
      body: JSON.stringify({ cameraIds }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      mode?: string
      grid?: string
      snapshots?: Record<string, string>
      expiresAt?: number
    }
    if (j.mode !== 'r2' || !j.grid) return null
    return {
      grid: j.grid,
      snapshots: j.snapshots ?? {},
      expiresAt: j.expiresAt ?? Date.now() + 3_600_000,
    }
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'r2-images: presign fetch failed')
    return null
  }
}

/**
 * 有効な presign 束を返す（無ければ取得）。取得できない間は
 * RETRY_AFTER_MS のバックオフを置き、Supabase 経路のまま静かに動き続ける。
 */
async function getBundle(cameraIds: string[]): Promise<PresignBundle | null> {
  const now = Date.now()
  const fresh = bundle && now < bundle.expiresAt - RENEW_MARGIN_MS
  // 既知のカメラ分の URL が揃っているか（カメラ追加時は取り直す）。
  const complete = fresh && cameraIds.every((id) => !!bundle!.snapshots[id])
  if (complete) return bundle

  if (now < nextAttemptAt) return fresh ? bundle : null
  if (inFlight) return inFlight

  inFlight = (async () => {
    const got = await fetchPresign(cameraIds)
    if (got) {
      bundle = got
      nextAttemptAt = 0
      logger.info({ cameras: Object.keys(got.snapshots).length }, 'r2-images: presign acquired')
    } else {
      nextAttemptAt = Date.now() + RETRY_AFTER_MS
    }
    inFlight = null
    return got ?? bundle
  })()
  return inFlight
}

async function put(url: string, buf: Buffer): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return true
    // 403/401 は期限切れ or 署名無効 → 次回取り直す。
    if (res.status === 401 || res.status === 403) bundle = null
    logger.debug({ status: res.status }, 'r2-images: PUT failed')
    return false
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'r2-images: PUT error')
    return false
  }
}

/** grid.jpg を R2 へ。成功時 true（false なら呼び出し側が Supabase へ）。 */
export async function putGridToR2(buf: Buffer, cameraIds: string[] = []): Promise<boolean> {
  const b = await getBundle(cameraIds)
  if (!b?.grid) return false
  return put(b.grid, buf)
}

/** カメラ別 snapshot.jpg を R2 へ。成功時 true。 */
export async function putSnapshotToR2(cameraId: string, buf: Buffer): Promise<boolean> {
  const b = await getBundle([cameraId])
  const url = b?.snapshots?.[cameraId]
  if (!url) return false
  return put(url, buf)
}
