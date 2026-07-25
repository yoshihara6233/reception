import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * テナントの数量クォータ（契約枠）判定ヘルパー。
 *
 * 対象は「店舗数」と、オプション機能（巡回/発報/検査）を **ON にできる店舗数**。
 * 上限は `tenants.max_stores / max_patrol / max_alarm / max_baggage`（NULL=無制限）。
 * 現在数は stores を数える（店舗数＝全件 / 機能＝opt_<feat>=true の件数）。
 *
 * 強制はアプリ層のみ（RLS ではない）＝店舗作成/編集・CSV 一括でこれを使う。
 * フェイルオープン: 列未適用・取得失敗時は上限 NULL（無制限扱い）を返し作成/変更を
 * 止めない。上限は「契約枠」でありセキュリティ境界ではないため可用性を優先する。
 *
 * 必ず service client（RLS バイパス）で呼ぶこと。テナント配下の全店舗を数える
 * 必要があり、呼び出し側ロールの可視範囲に縛られると過小カウントになるため。
 */
export type OptionKey = 'patrol' | 'alarm' | 'baggage'

export const OPTION_KEYS: OptionKey[] = ['patrol', 'alarm', 'baggage']

/** 各オプションの stores 側フラグ列名。 */
export const OPTION_STORE_COL: Record<OptionKey, 'opt_patrol' | 'opt_alarm' | 'opt_baggage'> = {
  patrol:  'opt_patrol',
  alarm:   'opt_alarm',
  baggage: 'opt_baggage',
}

/** 各オプションのテナント上限列名。 */
export const OPTION_MAX_COL: Record<OptionKey, 'max_patrol' | 'max_alarm' | 'max_baggage'> = {
  patrol:  'max_patrol',
  alarm:   'max_alarm',
  baggage: 'max_baggage',
}

/** 各オプションのテナント契約フラグ列名（master switch）。 */
export const OPTION_TENANT_COL: Record<OptionKey, 'opt_patrol' | 'opt_alarm' | 'opt_baggage'> = {
  patrol:  'opt_patrol',
  alarm:   'opt_alarm',
  baggage: 'opt_baggage',
}

export interface QuotaLimits {
  stores:  number | null
  patrol:  number | null
  alarm:   number | null
  baggage: number | null
}

/** テナント契約（master switch）。列未適用時は全 true（フェイルオープン）。 */
export interface TenantContract {
  patrol:  boolean
  alarm:   boolean
  baggage: boolean
}

function normLimit(v: unknown): number | null {
  const n = v as number | null
  if (n == null || !Number.isFinite(n)) return null
  return Math.max(0, Math.trunc(n))
}

/** テナントの上限4種と契約フラグをまとめて読む。フェイルオープン。 */
export async function getTenantQuota(
  svc: SupabaseClient,
  tenantId: string,
): Promise<{ limits: QuotaLimits; contract: TenantContract }> {
  const FAIL: { limits: QuotaLimits; contract: TenantContract } = {
    limits: { stores: null, patrol: null, alarm: null, baggage: null },
    contract: { patrol: true, alarm: true, baggage: true },
  }
  try {
    const { data, error } = await svc
      .from('tenants')
      .select('max_stores, max_patrol, max_alarm, max_baggage, opt_patrol, opt_alarm, opt_baggage')
      .eq('id', tenantId)
      .single()
    if (error || !data) return FAIL
    return {
      limits: {
        stores:  normLimit(data.max_stores),
        patrol:  normLimit(data.max_patrol),
        alarm:   normLimit(data.max_alarm),
        baggage: normLimit(data.max_baggage),
      },
      contract: {
        patrol:  !!data.opt_patrol,
        alarm:   !!data.opt_alarm,
        baggage: !!data.opt_baggage,
      },
    }
  } catch {
    return FAIL
  }
}

/** テナント配下の店舗数（有効/無効問わず全件）。取得失敗は 0。 */
export async function getStoreCount(svc: SupabaseClient, tenantId: string): Promise<number> {
  try {
    const { count } = await svc
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    return count ?? 0
  } catch {
    return 0
  }
}

/** そのオプションが ON の店舗数。`excludeStoreId` は編集中の自店舗を除外する用。 */
export async function getOptionOnCount(
  svc: SupabaseClient,
  tenantId: string,
  opt: OptionKey,
  excludeStoreId?: string,
): Promise<number> {
  try {
    let q = svc
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq(OPTION_STORE_COL[opt], true)
    if (excludeStoreId) q = q.neq('id', excludeStoreId)
    const { count } = await q
    return count ?? 0
  } catch {
    return 0
  }
}

/** 店舗数上限に対し `adding` 追加で超過するか。上限無しは常に false。 */
export function exceedsStoreLimit(limit: number | null, currentCount: number, adding = 1): boolean {
  if (limit == null) return false
  return currentCount + adding > limit
}

/**
 * ある店舗でオプション機能が有効か（Phase2 ランタイムゲート用）。
 * `stores.opt_<opt>` を読む。**フェイルオープン**: 判別不能（列未適用・取得失敗・
 * 店舗不明）は `true`（有効）を返し、既存の実行フローを壊さない。明示的に
 * false のときだけ「無効」＝実行スキップにする。必ず service client で呼ぶ。
 */
export async function isStoreOptionEnabled(
  svc: SupabaseClient,
  storeId: string,
  opt: OptionKey,
): Promise<boolean> {
  try {
    const col = OPTION_STORE_COL[opt]
    const { data, error } = await svc.from('stores').select(col).eq('id', storeId).maybeSingle()
    if (error || !data) return true
    return !!(data as Record<string, unknown>)[col]
  } catch {
    return true
  }
}

/** 店舗フォームに渡す、1オプションの利用可否。 */
export interface OptionAvailability {
  contracted: boolean       // テナントが当該機能を契約しているか
  limit:      number | null // ON にできる店舗数の上限（null=無制限）
  onCount:    number        // 既に ON の店舗数（excludeStoreId を除く）
}
export type StoreOptionAvailability = Record<OptionKey, OptionAvailability>

/**
 * テナントの各オプションについて「契約済みか・上限・現在ON数」を返す。
 * `excludeStoreId` を渡すと、その店舗を ON 数から除外する（編集画面で自店舗を除く）。
 */
export async function getStoreOptionAvailability(
  svc: SupabaseClient,
  tenantId: string,
  excludeStoreId?: string,
): Promise<StoreOptionAvailability> {
  const { limits, contract } = await getTenantQuota(svc, tenantId)
  const counts = await Promise.all(
    OPTION_KEYS.map((o) => getOptionOnCount(svc, tenantId, o, excludeStoreId)),
  )
  const out = {} as StoreOptionAvailability
  OPTION_KEYS.forEach((o, i) => {
    out[o] = { contracted: contract[o], limit: limits[o], onCount: counts[i] }
  })
  return out
}
