/**
 * エッジAPIリクエストの認証（T2）
 *
 * エッジは以下2ヘッダを付けて reception の edge API を叩く:
 *   x-edge-token       … 平文トークン（発行時に配布・reception は保存しない）
 *   x-edge-api-version … エッジの API バージョン（後方互換ポリシー）
 *
 * 認証の流れ:
 *   1. version ヘッダを検証（未指定=400 / 旧すぎ=426）。
 *   2. token をハッシュ化し、edge_api_tokens を token_hash で引く（service role）。
 *   3. 失効(revoked_at IS NOT NULL)は不可。
 *   4. last_used_at を更新（fire-and-forget）。
 *   5. { storeId, tenantId, tokenId } を返す。
 *
 * ルートはこの結果の status を見て 200 以外をそのまま返す。
 */
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { EDGE_TOKEN_HEADER, EDGE_VERSION_HEADER, checkEdgeVersion } from './token'

export type EdgeAuthResult =
  | { ok: true; storeId: string; tenantId: string; tokenId: string; version: number }
  | { ok: false; status: number; reason: string }

/** Supabase クライアントの最小インターフェース（テストで注入可能にする）。 */
export interface EdgeAuthDeps {
  fetchTokenByHash: (hash: string) => Promise<
    { id: string; store_id: string; tenant_id: string; revoked_at: string | null } | null
  >
  touchLastUsed: (id: string) => Promise<void>
}

/** 本番用の依存（service role で edge_api_tokens を読む）。 */
function defaultDeps(): EdgeAuthDeps {
  const supabase = createAdminClient()
  return {
    async fetchTokenByHash(hash) {
      const { data } = await supabase
        .from('edge_api_tokens')
        .select('id, store_id, tenant_id, revoked_at')
        .eq('token_hash', hash)
        .maybeSingle()
      return data ?? null
    },
    async touchLastUsed(id) {
      await supabase
        .from('edge_api_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', id)
    },
  }
}

/**
 * ヘッダ辞書（大文字小文字を吸収）とバージョン検証・トークン照合から認証結果を作る。
 * I/O は deps 越しなのでユニットテスト可能。
 */
export async function authenticateEdge(
  headers: { get(name: string): string | null },
  deps: EdgeAuthDeps = defaultDeps(),
): Promise<EdgeAuthResult> {
  const ver = checkEdgeVersion(headers.get(EDGE_VERSION_HEADER))
  if (!ver.ok) return { ok: false, status: ver.status, reason: ver.reason }

  const token = headers.get(EDGE_TOKEN_HEADER)
  if (!token || token.trim() === '') {
    return { ok: false, status: 401, reason: 'missing edge token' }
  }

  const hash = createHash('sha256').update(token, 'utf8').digest('hex')
  const row = await deps.fetchTokenByHash(hash)
  if (!row) {
    return { ok: false, status: 401, reason: 'unknown edge token' }
  }
  if (row.revoked_at) {
    return { ok: false, status: 401, reason: 'revoked edge token' }
  }

  // 最終使用時刻の更新は認証成否に影響させない（失敗しても認証は成立）。
  void deps.touchLastUsed(row.id).catch(() => {})

  return { ok: true, storeId: row.store_id, tenantId: row.tenant_id, tokenId: row.id, version: ver.version! }
}
