/**
 * キオスク API の店舗ガード（M3）
 *
 * iPad は admin_users アカウント（通常 store_manager・store_ids に当該店舗）で
 * ログインして運用する。requireAdmin のロール認可に加え、baggage_store_access
 * （RLS ヘルパ）と同じ判定をコードで行い、inspection_settings.enabled の店舗のみ通す。
 *
 * 書き込みは RLS にポリシーが無い（deny）ため service client で行う — このガードを
 * 通ったリクエストのみが書けるという二段構え。
 */
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { type AnnounceStep, type TerminalMode } from './inspection-flow'
import { loadTenantSettings } from './tenant-settings'

export interface KioskSettings {
  cameraIds: string[]
  retentionDays: number
  nvrRetentionDays: number
  timeoutSec: number
  terminalMode: TerminalMode
  audioEnabled: boolean
  audioVolume: number
  steps: AnnounceStep[]
}

export type BaggageAccessResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      user: { id: string }
      profile: { id: string; role: string; tenant_id: string; store_ids: string[] }
      store: { id: string; tenantId: string; name: string }
      svc: ReturnType<typeof createSupabaseService>
      /** RLS 配下のセッションクライアント（監査ログ INSERT 等に使う） */
      supa: Awaited<ReturnType<typeof import('@/lib/supabase/server').createSupabaseServer>>
    }

export type KioskGuardResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      store: { id: string; tenantId: string; name: string }
      settings: KioskSettings
      svc: ReturnType<typeof createSupabaseService>
    }

/**
 * 店舗アクセスのみ（enabled 不問）— 従業員マスタ・設定画面の API 用。
 * baggage_store_access（RLS ヘルパ）と同じ判定をコードで行う。
 */
export async function requireBaggageAccess(storeId: string | null | undefined): Promise<BaggageAccessResult> {
  if (!storeId) return { ok: false, status: 400, error: 'storeId_required' }

  const guard = await requireAdmin()
  if (!guard.ok) return { ok: false, status: guard.status, error: guard.error }

  const svc = createSupabaseService()
  const { data: store } = await svc
    .from('stores')
    .select('id, tenant_id, name')
    .eq('id', storeId)
    .maybeSingle()
  if (!store) return { ok: false, status: 404, error: 'store_not_found' }

  const p = guard.profile
  const allowed =
    p.role === 'super_admin' ||
    (p.role === 'tenant_admin' && store.tenant_id === p.tenant_id) ||
    (p.store_ids ?? []).includes(store.id)
  if (!allowed) return { ok: false, status: 403, error: 'forbidden' }

  return {
    ok: true,
    user: { id: guard.user.id },
    profile: p,
    store: { id: store.id, tenantId: store.tenant_id, name: store.name },
    svc,
    supa: guard.supa,
  }
}

/**
 * キオスク用: 店舗アクセス＋ inspection_settings.enabled の店舗のみ。
 * 店舗固有（enabled / camera_ids）は inspection_settings、その他の設定
 * （保持日数・タイムアウト・端末モード・音声・STEP文言）はテナント共通
 * （baggage_tenant_settings）から合成する。
 */
export async function requireKioskStore(storeId: string | null | undefined): Promise<KioskGuardResult> {
  const access = await requireBaggageAccess(storeId)
  if (!access.ok) return access
  const { svc, store } = access

  const [{ data: s }, tenant] = await Promise.all([
    svc.from('inspection_settings').select('enabled, camera_ids').eq('store_id', storeId).maybeSingle(),
    loadTenantSettings(svc, store.tenantId),
  ])
  if (!s?.enabled) return { ok: false, status: 403, error: 'baggage_not_enabled' }

  return {
    ok: true,
    store,
    settings: {
      cameraIds: (s.camera_ids ?? []) as string[],
      retentionDays: tenant.retentionDays,
      nvrRetentionDays: tenant.nvrRetentionDays,
      timeoutSec: tenant.timeoutSec,
      terminalMode: tenant.terminalMode,
      audioEnabled: tenant.audioEnabled,
      audioVolume: tenant.audioVolume,
      steps: tenant.steps,
    },
    svc,
  }
}
