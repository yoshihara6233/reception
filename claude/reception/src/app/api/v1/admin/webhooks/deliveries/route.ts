import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient()

  // Get endpoint IDs for this tenant
  const { data: endpoints } = await supabase
    .from('webhook_endpoints')
    .select('id')
    .eq('tenant_id', TENANT_ID)

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
