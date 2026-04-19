'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/useLocale'

interface Stats {
  currentCount: number
  todayCount: number
}

export function RealtimeStats({ initial }: { initial: Stats }) {
  const { t } = useLocale()
  const [stats, setStats] = useState(initial)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('visits-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits' },
        () => {
          refreshStats()
        }
      )
      .subscribe()

    async function refreshStats() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [current, todayResult] = await Promise.all([
        supabase
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'checked_in'),
        supabase
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .gte('check_in_at', today.toISOString()),
      ])

      setStats({
        currentCount: current.count ?? 0,
        todayCount: todayResult.count ?? 0,
      })
    }

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <StatCard
        label={t('admin.currentVisitors')}
        value={String(stats.currentCount)}
        suffix={t('admin.people')}
        accent="emerald"
      />
      <StatCard
        label={t('admin.todayVisitors')}
        value={String(stats.todayCount)}
        suffix={t('admin.people')}
        accent="navy"
      />
    </div>
  )
}

function StatCard({ label, value, suffix, accent }: {
  label: string
  value: string
  suffix: string
  accent: 'emerald' | 'navy'
}) {
  const accentMap = {
    emerald: 'text-emerald-600',
    navy: 'text-[#1e3a5f]',
  }
  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <p className="text-sm text-gray-400 mb-3">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-4xl font-bold ${accentMap[accent]}`}>{value}</span>
        <span className="text-sm text-gray-400 ml-1">{suffix}</span>
      </div>
    </div>
  )
}
