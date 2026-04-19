import { createAdminClient } from '@/lib/supabase/admin'
import { RealtimeStats } from './realtime-stats'
import { DashboardTable } from './dashboard-table'
import { VisitsTrendChart } from './visits-trend-chart'

export const dynamic = 'force-dynamic'

async function getDashboardData() {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [currentVisitors, todayVisitors, recentVisits] = await Promise.all([
    supabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'checked_in'),
    supabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('check_in_at', today.toISOString()),
    supabase
      .from('visits')
      .select('id, purpose, status, check_in_at, check_out_at, visitors(company, name)')
      .eq('tenant_id', tenantId)
      .order('check_in_at', { ascending: false })
      .limit(10),
  ])

  return {
    currentCount: currentVisitors.count ?? 0,
    todayCount: todayVisitors.count ?? 0,
    recentVisits: recentVisits.data ?? [],
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-6">Dashboard</h1>

      {/* Realtime stats */}
      <RealtimeStats initial={{ currentCount: data.currentCount, todayCount: data.todayCount }} />

      {/* Visitor trend chart */}
      <VisitsTrendChart />

      {/* Recent visits table (client component for i18n) */}
      <DashboardTable recentVisits={data.recentVisits as any} />
    </div>
  )
}
