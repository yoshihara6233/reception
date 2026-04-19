import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Vercel Cron Job endpoint
// Configure in vercel.json: { "crons": [{ "path": "/api/v1/cron/auto-checkout", "schedule": "0 * * * *" }] }

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets CRON_SECRET automatically)
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('auto_checkout_stale_visits')

  if (error) {
    console.error('Auto-checkout error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    closedCount: data,
    timestamp: new Date().toISOString(),
  })
}
