import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  // Get endpoint IDs for this tenant
  const { data: endpoints } = await supabase
    .from('webhook_endpoints')
    .select('id')
    .eq('tenant_id', ctx.tenant_id)

  if (!endpoints?.length) {
    return NextResponse.json({ deliveries: [] })
  }

  const endpointIds = endpoints.map(e => e.id)

  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, endpoint_id, event_type, status, http_status, attempted_at, duration_ms')
    .in('endpoint_id', endpointIds)
    .order('attempted_at', { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deliveries: data ?? [] })
}
