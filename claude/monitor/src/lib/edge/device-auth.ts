/**
 * エッジ→クラウド API の device_token 認証（共通化）。
 *
 * clip-upload / 巡回 ingest と同形: `Authorization: Bearer <device_token>` を
 * SHA-256 ハッシュで edge_devices と突き合わせる（平文トークンは DB に無い）。
 * 返すのは edge の id と store_id だけ — 呼び出し側はこの edge の所有物
 * （recorders.edge_id 等）への操作かを必ず確かめること。トークンが正しくても
 * **他エッジのレコーダを書ける形にしない**。
 */
import type { NextRequest } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { hashDeviceToken } from '@/lib/edge/device-token'
import { logSecurityEvent, requestIp } from '@/lib/security/events'

export interface AuthedEdge {
  id: string
  store_id: string
}

/** 認証できなければ null（呼び出し側で 401 を返す）。 */
export async function authenticateEdge(req: NextRequest): Promise<AuthedEdge | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null

  const svc = createSupabaseService()
  const { data } = await svc
    .from('edge_devices')
    .select('id, store_id')
    .eq('device_token_hash', hashDeviceToken(token))
    .maybeSingle()
  const edge = (data as AuthedEdge | null) ?? null
  if (!edge) {
    logSecurityEvent({ kind: 'edge.auth_failed', ip: requestIp(req.headers), path: req.nextUrl?.pathname ?? null, status: 401 })
    return null
  }
  // 停止したテナントの拠点からは受けない (2026-10-29・自主診断 ASVS 7.4.2・取扱説明書 第 2 部 9 章)
  if (await storeTenantSuspended(svc, edge.store_id)) {
    logSecurityEvent({ kind: 'edge.auth_failed', ip: requestIp(req.headers), path: req.nextUrl?.pathname ?? null, status: 401, detail: { edge: edge.id, reason: 'tenant_suspended' } })
    return null
  }
  return edge
}

/**
 * 店舗のテナントが停止 (suspended) しているか。引けなかったときは停止とみなさない
 * (瞬断で全拠点の受信を止めないため。DB の側でも tenant_active_only が止めている)。
 */
export async function storeTenantSuspended(
  svc: ReturnType<typeof createSupabaseService>, storeId: string | null | undefined,
): Promise<boolean> {
  if (!storeId) return false
  const { data } = await svc.from('stores').select('tenants(status)').eq('id', storeId).maybeSingle()
  const rel = (data as { tenants?: unknown } | null)?.tenants
  const t = (Array.isArray(rel) ? rel[0] : rel) as { status?: string } | undefined
  return t?.status === 'suspended'
}
