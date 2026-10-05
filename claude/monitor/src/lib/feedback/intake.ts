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
