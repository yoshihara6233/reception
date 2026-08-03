/**
 * ライブ画像（16分割 grid / カメラ別 snapshot）の Cloudflare R2 保存。
 *
 * 背景（2026-08-03 Free 上限超過 11.4GB/5GB）: grid/snapshot はライブの鮮度を
 * 優先して CDN を意図的に迂回（`?t=` キャッシュバスター＋no-store）していたため、
 * 毎フレームが Supabase の課金エグレスになっていた。視聴 1 時間あたり約 0.5 GB。
 * R2 はエグレス無料なので、手荷物検査クリップ（lib/baggage/r2.ts）と同じ方式へ揃える。
 *
 * 方式:
 *  - エッジは /api/edges/[id]/image-upload-url で presigned PUT を受け取り R2 へ直接 PUT。
 *    キーが固定（grid.jpg / snapshot.jpg を上書き）なので、TTL 内は同じ URL を再利用でき、
 *    毎フレームの presign 往復は発生しない。
 *  - 配信は presigned GET へ 302。ブラウザが R2 から直接取るため Vercel 帯域も使わない。
 *  - R2 にオブジェクトが無い（＝まだ OTA 前のエッジ）場合は従来の Supabase 経路へ
 *    フォールバックする。デプロイと OTA の順序に依存しない。
 *
 * env: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 *      R2_EDGE_BUCKET（既定 'edge-images'）
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function edgeImagesR2Configured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

function bucket(): string {
  return process.env.R2_EDGE_BUCKET ?? 'edge-images'
}

let client: S3Client | null = null
function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}

/** Supabase 側と同じ相対パスを R2 キーにも使う（移行時の突合を楽にする）。 */
export function gridKey(edgeId: string): string {
  return `edges/${edgeId}/grid.jpg`
}
export function snapshotKey(edgeId: string, cameraId: string): string {
  return `edges/${edgeId}/cam/${cameraId}/snapshot.jpg`
}

/**
 * エッジ直アップロード用 presigned PUT。
 * TTL 既定 1 時間 — キー固定なのでエッジは URL を使い回し、期限切れ時だけ取り直す。
 */
export function presignEdgeImagePut(key: string, ttlSec = 3600): Promise<string> {
  return getSignedUrl(r2(), new PutObjectCommand({
    Bucket: bucket(), Key: key, ContentType: 'image/jpeg',
  }), { expiresIn: ttlSec })
}

/**
 * 配信用 presigned GET（302 リダイレクト先）。
 * ライブは常に最新フレームが要るので、R2 のレスポンスヘッダも no-store に上書きする
 * （TTL 内は URL が同一になり得るため、これが無いとブラウザがキャッシュする）。
 */
export function presignEdgeImageGet(key: string, ttlSec = 120): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({
    Bucket: bucket(), Key: key,
    ResponseCacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
  }), { expiresIn: ttlSec })
}

/**
 * R2 に当該オブジェクトがあるか（＝このエッジは R2 へ移行済みか）。
 *
 * 毎フレーム HEAD を打たないよう、ウォームなインスタンス内で短時間メモ化する。
 * 誤って古い判定を掴んでも、返すのは「同じキーの最新オブジェクト or Supabase の
 * 最新オブジェクト」のどちらかなので、映像が壊れることはない。
 */
const existsMemo = new Map<string, { exists: boolean; at: number }>()
const MEMO_TTL_MS = 60_000

export async function edgeImageExists(key: string): Promise<boolean> {
  const hit = existsMemo.get(key)
  const now = Date.now()
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.exists

  let exists = false
  try {
    await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
    exists = true
  } catch {
    exists = false
  }
  existsMemo.set(key, { exists, at: now })
  return exists
}
