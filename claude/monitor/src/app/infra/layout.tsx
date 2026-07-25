import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

/**
 * /infra（死活監視）は SaaS 運営者向けの全テナント横断 運用監視。
 * テナント各社（tenant_admin / store_manager 等）には見せず、super_admin 専用とする。
 * ②運営管理プレーンの一部として、配下すべてをこの layout でゲートする。
 */
export default async function InfraLayout({ children }: { children: React.ReactNode }) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users').select('role').eq('auth_user_id', user.id).single()
  if (me?.role !== 'super_admin') notFound()

  return <>{children}</>
}
