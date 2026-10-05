import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ATTACHMENT_BUCKET, type AttachmentType } from './image'

/**
 * 要望の画像の置き場（非公開バケット feedback-attachments・GVMS_CLOUD_SPEC §12.6）。
 *
 * 置き場所は `<tenant_id>/<item_id>`。テナントの削除のときに `<tenant_id>/` ごと消せるよう、
 * 先頭をテナントにする。読み書きは service role だけ（利用者のポリシーは置いていない）。
 */

/** 期限つきの URL の長さ（秒）。画面の「開く」・見本はその都度 API から取り直す */
export const ATTACHMENT_URL_TTL_SEC = 300

export function attachmentObjectPath(tenantId: string, itemId: string): string {
  return `${tenantId}/${itemId}`
}

/** 画像を置く（同じ場所は上書き）。失敗したら理由の文を返す */
export async function putAttachment(
  svc: SupabaseClient, path: string, bytes: Uint8Array, type: AttachmentType,
): Promise<string | null> {
  const { error } = await svc.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, bytes, { contentType: type, upsert: true, cacheControl: '0' })
  return error ? error.message : null
}

/** 置いた画像を消す（無いものを消しても失敗にしない）。失敗したら理由の文を返す */
export async function removeAttachments(svc: SupabaseClient, paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null
  const { error } = await svc.storage.from(ATTACHMENT_BUCKET).remove(paths)
  return error ? error.message : null
}

/** 期限つきの URL。作れなければ null */
export async function signAttachmentUrl(svc: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await svc.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, ATTACHMENT_URL_TTL_SEC)
  return error || !data?.signedUrl ? null : data.signedUrl
}

/**
 * テナントの画像をすべて消す（テナントの削除のとき）。`<tenant_id>/` の下を 1,000 件ずつ
 * 一覧して消し、空になるまで繰り返す。消せた数と、失敗の理由（あれば）を返す。
 */
export async function removeTenantAttachments(
  svc: SupabaseClient, tenantId: string, maxRounds = 100,
): Promise<{ deleted: number; error: string | null }> {
  let deleted = 0
  for (let round = 0; round < maxRounds; round++) {
    const { data, error } = await svc.storage.from(ATTACHMENT_BUCKET).list(tenantId, { limit: 1000 })
    if (error) return { deleted, error: error.message }
    const names = (data ?? []).map((o) => o.name).filter((n): n is string => !!n)
    if (names.length === 0) return { deleted, error: null }
    const rmErr = await removeAttachments(svc, names.map((n) => `${tenantId}/${n}`))
    if (rmErr) return { deleted, error: rmErr }
    deleted += names.length
  }
  return { deleted, error: 'too_many_rounds' }
}
