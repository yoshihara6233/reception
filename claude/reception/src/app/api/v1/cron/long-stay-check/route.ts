import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSlackNotification } from '@/lib/notifications/slack'
import { sendEmailNotification } from '@/lib/notifications/email'

export const dynamic = 'force-dynamic'

// Default long-stay threshold: 2 hours
const LONG_STAY_HOURS = 2

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || authHeader !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const thresholdTime = new Date(Date.now() - LONG_STAY_HOURS * 60 * 60 * 1000)

  // Find all visits that are checked_in and have exceeded the threshold
  const { data: longStayVisits, error } = await supabase
    .from('visits')
    .select('id, tenant_id, store_id, visitor_id, check_in_at, visitors(name, company), stores(name)')
    .eq('status', 'checked_in')
    .lt('check_in_at', thresholdTime.toISOString())

  if (error) {
    console.error('[long-stay-check] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let notificationsSent = 0

  for (const visit of longStayVisits ?? []) {
    // Get notification rules for this tenant/store for long_stay events
    const { data: rules } = await supabase
      .from('notification_rules')
      .select('*')
      .eq('tenant_id', visit.tenant_id)
      .eq('event_type', 'long_stay')
      .eq('enabled', true)

    if (!rules?.length) continue

    const visitor = visit.visitors as { name?: string; company?: string } | null
    const store = visit.stores as { name?: string } | null
    const visitorName = visitor?.name || '不明'
    const company = visitor?.company || '不明'
    const storeName = store?.name || '不明'
    const checkedInAt = new Date(visit.check_in_at)
    const hoursStayed = Math.floor((Date.now() - checkedInAt.getTime()) / (1000 * 60 * 60))
    const message = `⚠️ [${visitorName} / ${company}] が [${storeName}] に ${hoursStayed}時間以上滞在しています`

    for (const rule of rules) {
      if (rule.store_id && rule.store_id !== visit.store_id) continue

      if (rule.channel === 'slack' && rule.config?.webhookUrl) {
        void sendSlackNotification(rule.config.webhookUrl, message)
        notificationsSent++
      } else if (rule.channel === 'email' && rule.config?.email) {
        void sendEmailNotification(
          rule.config.email,
          '長時間滞在アラート',
          `<p>${message}</p>`
        )
        notificationsSent++
      }
    }
  }

  return NextResponse.json({
    checked: longStayVisits?.length ?? 0,
    notificationsSent,
    threshold: `${LONG_STAY_HOURS}h`,
  })
}
