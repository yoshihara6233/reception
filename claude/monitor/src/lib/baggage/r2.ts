/**
 * 手荷物検査クリップの Cloudflare R2 保存（コスト是正）。
 *
 * 店長の「全件確認再生」運用では転送費が支配的（Supabase: 保管$0.021/GB＋
 * エグレス$0.09/GB）。R2 はエグレス完全無料（保管$0.015/GB）のため、
 * 大規模店で約 ¥14,700 → ¥3,300/月 に圧縮できる（handbook §15.3）。
 *
 * 方式:
 *  - エッジは /api/baggage/edge/clip-upload で presigned PUT を受け取り
 *    R2 へ直接アップロード（Vercel の 4.5MB ボディ上限を回避）。
 *  - inspection_clips.storage_path は `r2:<key>` プレフィックスで保存先を表す
 *    （スキーマ変更なし・旧 Supabase パスと共存。エッジ更新とデプロイの順序に
 *    依存しないための後方互換設計）。
 *  - 再生は presigned GET へ 302（従来の署名URLプロキシと同形・体感同等）。
 *  - env 未設定なら常に Supabase へフォールバック（何も壊さない）。
 *
 * env: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 *      R2_BAGGAGE_BUCKET（既定 'baggage-clips'）
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const R2_PREFIX = 'r2:'

export function isR2Path(storagePath: string): boolean {
  return storagePath.startsWith(R2_PREFIX)
}

/** `r2:<key>` → `<key>`（R2パス以外はそのまま返す）。 */
export function r2Key(storagePath: string): string {
  return isR2Path(storagePath) ? storagePath.slice(R2_PREFIX.length) : storagePath
}

export function toR2Path(key: string): string {
  return `${R2_PREFIX}${key}`
}

export function r2Configured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

function bucket(): string {
  return process.env.R2_BAGGAGE_BUCKET ?? 'baggage-clips'
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

/** エッジ直アップロード用 presigned PUT（TTL 10分 — 切り出し後すぐ使う前提）。 */
export async function presignClipPut(key: string, ttlSec = 600): Promise<string> {
  return getSignedUrl(r2(), new PutObjectCommand({
    Bucket: bucket(), Key: key, ContentType: 'video/mp4',
  }), { expiresIn: ttlSec })
}

/** 再生用 presigned GET（302 リダイレクト先）。 */
export async function presignClipGet(key: string, ttlSec = 300): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttlSec })
}

/** 保持期間 purge 用の一括削除（最大1000件/回は呼び出し側で分割）。 */
export async function deleteClipObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await r2().send(new DeleteObjectsCommand({
    Bucket: bucket(),
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
  }))
}
