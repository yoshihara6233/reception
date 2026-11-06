/**
 * 監査の記録の書き出し先 (R2・専用バケット・専用キー)。docs/audit-archive.md。
 *
 * env:
 *   AUDIT_ARCHIVE_BUCKET             専用バケット (Bucket lock 5 年を掛ける)
 *   AUDIT_ARCHIVE_ACCESS_KEY_ID      そのバケットだけの R2 の API トークン (Object Read & Write)
 *   AUDIT_ARCHIVE_SECRET_ACCESS_KEY
 *   AUDIT_ARCHIVE_ACCOUNT_ID         省略時は R2_ACCOUNT_ID (同じ Cloudflare のアカウント)
 * 映像の R2 キー (R2_ACCESS_KEY_ID) は使わない。あちらは消せる権限を持つため。
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { ArchiveStore } from '@/lib/audit/archive'

export function auditArchiveConfigured(): boolean {
  const e = process.env
  return !!(
    e.AUDIT_ARCHIVE_BUCKET &&
    e.AUDIT_ARCHIVE_ACCESS_KEY_ID &&
    e.AUDIT_ARCHIVE_SECRET_ACCESS_KEY &&
    (e.AUDIT_ARCHIVE_ACCOUNT_ID || e.R2_ACCOUNT_ID)
  )
}

function status(e: unknown): number | undefined {
  return (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
}

export function r2ArchiveStore(): ArchiveStore {
  const e = process.env
  const account = e.AUDIT_ARCHIVE_ACCOUNT_ID || e.R2_ACCOUNT_ID
  const bucket = e.AUDIT_ARCHIVE_BUCKET!
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: e.AUDIT_ARCHIVE_ACCESS_KEY_ID!, secretAccessKey: e.AUDIT_ARCHIVE_SECRET_ACCESS_KEY! },
  })
  return {
    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        const bytes = await r.Body?.transformToByteArray()
        return bytes ? Buffer.from(bytes) : Buffer.alloc(0)
      } catch (err) {
        if (status(err) === 404) return null
        throw err
      }
    },
    async putOnce(key, body, contentType) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }))
        return 'created'
      } catch (err) {
        // 412: 既にある (上書きしない)。Bucket lock の中の物は 409/403 で断られることもある
        const s = status(err)
        if (s === 412 || s === 409) return 'exists'
        throw err
      }
    },
  }
}
