/**
 * 拠点 (G・VMS) の SSO の同意 (ログインの一本化・GVMS_CLOUD_SPEC §9.5・2026-10-29)。
 *
 * 以前は同意の画面を開いた (GET) だけで承認しており、テナントに属さない利用者でも承認していた
 * (自主診断 ASVS 7.6.2・10.7.1)。いまは次の 2 つを守る:
 *   1. 承認は利用者がボタンを押したとき (POST・Server Action) だけ。画面を開いただけでは出さない
 *   2. その拠点に入れる利用者だけ承認する。判定はトークンのフック (gvms_access_token_hook) の
 *      役割の読み替えと同じ。入れない利用者は断る (拠点に gvms_role の無いトークンを渡さない)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** 拠点で使う役割 (G・VMS の役割)。 */
export type GvmsRole = 'admin' | 'manager' | 'operator' | 'viewer'

/** 画面に出す役割の名前 (G・VMS の画面の呼び名にそろえる)。 */
export const GVMS_ROLE_LABEL: Record<GvmsRole, string> = {
  admin: '管理者（拠点が許したとき。既定は運用管理者）',
  manager: '運用管理者',
  operator: 'オペレータ',
  viewer: '閲覧者',
}

interface Profile { role: string; tenant_id: string | null; store_ids: string[] | null }

/**
 * クラウドの役割から拠点の役割を決める (gvms_access_token_hook と同じ読み替え)。入れなければ null。
 */
export function gvmsRoleFor(p: Profile | null, store: string | null, tenant: string | null): GvmsRole | null {
  if (!p) return null
  const stores = p.store_ids ?? []
  if (p.role === 'super_admin') return 'admin'
  if (p.role === 'tenant_admin' && p.tenant_id && tenant && p.tenant_id === tenant) return 'manager'
  if ((p.role === 'store_manager' || p.role === 'baggage_manager') && store && stores.includes(store)) return 'operator'
  if (p.role === 'viewer' && store && stores.includes(store)) return 'viewer'
  return null
}

export interface ConsentTarget {
  /** 登録した G・VMS の拠点のクライアントか */
  known: boolean
  edgeName: string | null
  storeName: string | null
  role: GvmsRole | null
}

/** 同意の対象 (どの拠点か・この利用者が入れるか) を引く。サービスの接続で読む。 */
export async function consentTarget(svc: SupabaseClient, clientId: string, userId: string): Promise<ConsentTarget> {
  const { data: c } = await svc.from('gvms_oidc_clients').select('edge_id').eq('client_id', clientId).maybeSingle()
  if (!c) return { known: false, edgeName: null, storeName: null, role: null }
  const { data: e } = await svc.from('edge_devices')
    .select('name, store_id, stores(name, tenant_id, tenants(status))').eq('id', c.edge_id).maybeSingle()
  const store = (e?.stores ?? null) as { name?: string; tenant_id?: string; tenants?: { status?: string } | null } | null
  const { data: p } = await svc.from('admin_users')
    .select('role, tenant_id, store_ids').eq('auth_user_id', userId).maybeSingle()
  return {
    known: true,
    edgeName: (e?.name as string | undefined) ?? null,
    storeName: store?.name ?? null,
    // 拠点のテナントが停止していたら誰も入れない (2026-10-29・ASVS 7.4.2・トークンのフックと同じ)
    role: store?.tenants?.status === 'suspended'
      ? null
      : gvmsRoleFor(p as Profile | null, (e?.store_id as string | undefined) ?? null, store?.tenant_id ?? null),
  }
}

/** authorization_id の形 (Supabase が出す ID)。 */
export function validAuthorizationId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}
