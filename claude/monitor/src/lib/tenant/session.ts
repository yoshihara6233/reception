import 'server-only'
import { cache } from 'react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * リクエスト単位で 1 回だけ実行される「認証・テナント解決の素材」。
 *
 * 背景（2026-08-09 の体感5秒問題）:
 * AppShell / resolveTenantFeatures / resolveAdminContext がそれぞれ独立に
 * 「ユーザー取得 → admin_users → tenants」を実行しており、店舗を 1 回クリックする
 * ごとに直列で auth.getUser()×4・admin_users×2・tenants×3 が飛んでいた。
 * Vercel 実行リージョンが iad1（米国東部）で DB が東京だったため、1 往復 ≒ 160ms が
 * そのまま積み上がっていた（リージョンは vercel.json で hnd1 へ移動済み）。
 *
 * React の cache() は「同一リクエスト内」でのみメモ化するため、リクエストを跨いだ
 * 汚染は起きない。引数を取らない形にしてあるのは、cache() が引数の同一性でキーを
 * 作る以上、呼び出し側が別々の SupabaseClient を渡すと重複排除が効かないため。
 */

/** Supabase サーバークライアント。cookie 読み取りのみでネットワークは発生しない。 */
export const getServerClient = cache(async () => createSupabaseServer())

/** ログイン中のユーザー。auth.getUser() は毎回ネットワーク検証が走るので必ずここ経由で。 */
export const getSessionUser = cache(async () => {
  const supa = await getServerClient()
  const { data: { user } } = await supa.auth.getUser()
  return user
})

export interface AdminUserRow {
  role: string
  tenant_id: string | null
  store_ids: string[] | null
}

/** 自分の admin_users 行（ロール・所属テナント・担当店舗）。未ログイン/未登録は null。 */
export const getAdminUserRow = cache(async (): Promise<AdminUserRow | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const supa = await getServerClient()
  const { data } = await supa
    .from('admin_users')
    .select('role, tenant_id, store_ids')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return (data as AdminUserRow | null) ?? null
})

export interface TenantRow {
  id: string
  name: string | null
  opt_patrol: boolean | null
  opt_alarm: boolean | null
  opt_baggage: boolean | null
}

/**
 * テナント 1 行。表示名（acting）とオプションフラグ（features）の両方の用途で
 * 使う列をまとめて 1 回で引く。以前は用途ごとに別クエリを投げていた。
 * service client で読むのは tenants の RLS と監視 admin の JWT tenant=NULL を回避するため。
 */
export const getTenantRow = cache(async (tenantId: string): Promise<TenantRow | null> => {
  const svc = createSupabaseService()
  const { data } = await svc
    .from('tenants')
    .select('id, name, opt_patrol, opt_alarm, opt_baggage')
    .eq('id', tenantId)
    .maybeSingle()
  return (data as TenantRow | null) ?? null
})
