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
  return (data as AuthedEdge | null) ?? null
}
