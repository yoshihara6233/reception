/**
 * 遠隔視聴（HLS）の置き場 — Cloudflare R2（GVMS_CLOUD_SPEC §5.2・§5.3）。
 *
 * 拠点（nvmsd）は区切りとプレイリストを**署名付き PUT で R2 へ**置き、クラウドは
 * 視聴者へ中継する。置き場はセッションごとに `video/<session_id>/` 配下の固定の名前:
 *   slot0 … slot7（ライブ）/ slot0 … slot15（録画再生）・init・playlist
 *
 * 決めたこと:
 *  - **PUT の署名に Content-Type を含めない。** 区切りは ts（video/mp2t）と
 *    m4s（video/mp4）の両方があり、同じ置き場に入る。縛ると片方が 403 になる。
 *  - **送り先は自社ドメインの Worker（intereco-edge-images）を優先する。** R2 の S3 API の
 *    ホスト名（*.r2.cloudflarestorage.com）は、eo光など SNI で遮断する回線から届かない
 *    （静止画ライブと同じ問題。2026-09-25 に .200 で TLS handshake failure を実測）。
 *    Worker が未設定のときだけ S3 の署名付き URL にする。
 *  - **クラウドが読む・消すのも Worker を通す**（届いたかの確認・視聴者への中継・片付け）。
 *    S3 API で読むと R2 のキーの権限や設定に左右される（2026-09-25 本番で、拠点は Worker 経由で
 *    書けているのにクラウドが読めず映らなかった）。書く・読む・消すを 1 つの経路にそろえる。
 *  - **視聴者へは署名付き GET を渡さず、ルートが中継する。** 署名付き URL を
 *    API 応答（302 の Location を含む）に出さない（§6）。
 *  - バケットは静止画ライブと同じ（R2_EDGE_BUCKET）。専用にしたい場合は
 *    R2_VIDEO_BUCKET で分けられる。映像はクラウドに溜めない（§1-5）ので、
 *    セッションの終了後に cron（/api/cron/video-sessions）が消す。
 */
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { edgeImagesBucket, edgeImagesR2Configured, r2 } from '@/lib/storage/edge-images-r2'
import { edgeImagesWorkerConfigured, signEdgeImageUrl } from '@/lib/storage/edge-images-sign'
import { slotCount, type VideoKind } from '@/lib/video/session-logic'

/** 署名の期限。拠点は期限の 5 分前に /api/edge/video/upload-urls で取り直す（§5.2.3）。 */
export const VIDEO_UPLOAD_TTL_SEC = 3600

export function videoR2Configured(): boolean {
  return edgeImagesR2Configured()
}

function bucket(): string {
  return process.env.R2_VIDEO_BUCKET?.trim() || edgeImagesBucket()
}

export type VideoObjectName = 'playlist' | 'init' | `slot${number}`

export function videoKey(sessionId: string, name: VideoObjectName): string {
  return `video/${sessionId}/${name}`
}

/** §5.2.1 の upload（拠点へ渡す送り先の束）。**URL には署名が入る — ログ・画面・API 応答に出さない。** */
export interface VideoUpload {
  slots: string[]
  init: string
  playlist: string
  expires_at: number
}

function presignPut(key: string): Promise<string> {
  if (edgeImagesWorkerConfigured()) {
    const u = signEdgeImageUrl('PUT', key, VIDEO_UPLOAD_TTL_SEC)
    if (u) return Promise.resolve(u)
  }
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: VIDEO_UPLOAD_TTL_SEC,
  })
}

export async function presignVideoUpload(sessionId: string, kind: VideoKind, nowMs = Date.now()): Promise<VideoUpload> {
  const n = slotCount(kind)
  const [slots, init, playlist] = await Promise.all([
    Promise.all(Array.from({ length: n }, (_, i) => presignPut(videoKey(sessionId, `slot${i}`)))),
    presignPut(videoKey(sessionId, 'init')),
    presignPut(videoKey(sessionId, 'playlist')),
  ])
  // 署名は呼び出しの時点から数える。拠点が取り直す目安なので、少し手前に置く
  return { slots, init, playlist, expires_at: nowMs + (VIDEO_UPLOAD_TTL_SEC - 30) * 1000 }
}

export interface VideoObject {
  body: ReadableStream
  length: number | undefined
}

/** Worker を通す署名付き URL（Worker が未設定なら null → S3 API を使う）。 */
function workerUrl(method: 'GET' | 'DELETE', key: string): string | null {
  return edgeImagesWorkerConfigured() ? signEdgeImageUrl(method, key, 60) : null
}

/** 置き場の中身。無ければ null。 */
export async function getVideoObject(key: string): Promise<VideoObject | null> {
  const u = workerUrl('GET', key)
  if (u) {
    const res = await fetch(u, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok || !res.body) throw new Error(`video_get_failed:${res.status}`)
    const len = Number(res.headers.get('Content-Length'))
    return { body: res.body, length: Number.isFinite(len) && len > 0 ? len : undefined }
  }
  try {
    const res = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    if (!res.Body) return null
    return { body: res.Body.transformToWebStream(), length: res.ContentLength }
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

export async function videoObjectExists(key: string): Promise<boolean> {
  const u = workerUrl('GET', key) // HEAD は GET の署名で通る
  if (u) {
    const res = await fetch(u, { method: 'HEAD', cache: 'no-store' })
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`video_head_failed:${res.status}`)
    return true
  }
  try {
    await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
    return true
  } catch (e) {
    if (isNotFound(e)) return false
    throw e
  }
}

/** セッションの置き場を全部消す（無い名前が混じっても成功する）。 */
export async function deleteVideoObjects(sessionId: string, kind: VideoKind): Promise<void> {
  const names: VideoObjectName[] = ['playlist', 'init', ...Array.from({ length: slotCount(kind) }, (_, i) => `slot${i}` as const)]
  if (edgeImagesWorkerConfigured()) {
    const results = await Promise.all(names.map(async (n) => {
      const u = workerUrl('DELETE', videoKey(sessionId, n))
      if (!u) return false
      const res = await fetch(u, { method: 'DELETE', cache: 'no-store' })
      return res.ok || res.status === 404
    }))
    if (results.some((ok) => !ok)) throw new Error('video_delete_failed:worker')
    return
  }
  const res = await r2().send(new DeleteObjectsCommand({
    Bucket: bucket(),
    Delete: { Objects: names.map((n) => ({ Key: videoKey(sessionId, n) })), Quiet: true },
  }))
  if (res.Errors && res.Errors.length > 0) {
    throw new Error(`video_delete_failed:${res.Errors[0]?.Code ?? 'unknown'}`)
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404
}
