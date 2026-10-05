import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { REQUEST_MAX_BYTES } from './schema'

/**
 * 受け口（現場・クラウドの画面）で共通の下ごしらえ。
 */

/** 本文を読む。大きすぎる・JSON でないときは理由を返す（中身は返さない）。 */
export async function readJsonBody(req: Request, maxBytes = REQUEST_MAX_BYTES): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }
> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' }
  const text = await req.text().catch(() => null)
  if (text === null) return { ok: false, status: 400, error: 'invalid_body' }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: 'invalid_body' }
  }
}

export interface TenantFeedbackFlag {
  name: string | null
  /** false = テナントが要望の受付を止めている */
  enabled: boolean
}

/** テナントの名前と要望の受付の可否。取れなければ null（呼び出し側で 500）。 */
export async function loadTenantFeedbackFlag(svc: SupabaseClient, tenantId: string): Promise<TenantFeedbackFlag | null> {
  const { data, error } = await svc
    .from('tenants')
    .select('name, feedback_enabled')
    .eq('id', tenantId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { name: string | null; feedback_enabled: boolean | null }
  return { name: row.name ?? null, enabled: row.feedback_enabled !== false }
}

/**
 * 本文をバイト列のまま読む（画像の受け口・画像つきの送信）。上限を超えたら読むのをやめて 413。
 * content-length を先に見て、無い・偽っているときも読みながら数えて止める
 * （Vercel の関数の本文の上限 4.5 MB より手前で締めるため）。
 */
export async function readBytesLimited(req: Request, maxBytes: number): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 413; error: string }
> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' }
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, status: 413, error: 'payload_too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400, error: 'invalid_body' }
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return { ok: true, bytes: out }
}
