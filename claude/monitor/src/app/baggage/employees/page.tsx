/**
 * /baggage/employees — 従業員マスタ（M4）
 *
 * 顔認証世代の従業員登録（氏名・社員コード・顔登録）。店舗は RLS で可視な範囲、
 * 従業員一覧はレガシー RLS（JWT tenant 依存）を避け service 読み
 * （店舗の可視性は RLS 由来の選択肢で担保 — intereco-patterns §6 と同方式）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { TenantGate } from '@/components/TenantGate'
import { resolveMonitorScope } from '@/lib/tenant/monitor-scope'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from '../nav'
import { EmployeesClient, type EmployeeRow } from './EmployeesClient'

export default async function BaggageEmployeesPage(
  { searchParams }: { searchParams: Promise<{ store?: string }> },
) {
  const sp = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // テナント分離: 店舗選択肢は「操作中テナント（super_admin）／所属テナント／担当店舗」に限定。
  // 従来は RLS 任せで、super_admin が操作中テナント外の全店舗を選べてしまっていた（他テナント漏洩）。
  const scope = await resolveMonitorScope(supa)
  if (scope.needsTenant) {
    return (
      <AdminShell pathname="/baggage/employees" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
        <TenantGate />
      </AdminShell>
    )
  }
  const { data: stores } = await supa.from('stores').select('id, name').in('id', scope.storeIds).order('name')
  const storeOptions = (stores ?? []) as { id: string; name: string }[]
  const storeId = sp.store && storeOptions.some((s) => s.id === sp.store) ? sp.store : storeOptions[0]?.id

  let employees: EmployeeRow[] = []
  if (storeId) {
    const svc = createSupabaseService()
    const { data } = await svc
      .from('employees')
      .select('id, name, employee_code, face_photo_path, rekognition_face_id, consent_at, consent_version, created_at')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('name')
    employees = (data ?? []) as EmployeeRow[]
  }

  return (
    <AdminShell pathname="/baggage/employees" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
      <PageHeader title="従業員マスタ" crumb={[{ href: '/baggage', label: BAGGAGE_NAV_TITLE }]} />
      <div className="p-5">
        {storeOptions.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
            表示できる店舗がありません。
          </div>
        ) : (
          <EmployeesClient storeOptions={storeOptions} storeId={storeId!} employees={employees} />
        )}
      </div>
    </AdminShell>
  )
}
