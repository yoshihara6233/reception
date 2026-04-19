import { PurposeHeatmap } from './purpose-heatmap'

export const dynamic = 'force-dynamic'

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-6">アナリティクス</h1>
      <PurposeHeatmap />
    </div>
  )
}
