import { DashboardContent } from './dashboard-content'

export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-6">ダッシュボード</h1>
      <DashboardContent />
    </div>
  )
}
