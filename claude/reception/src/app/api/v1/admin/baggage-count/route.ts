import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

  const { count } = await supabase
    .from('baggage_declarations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'flagged'])

  return NextResponse.json({ count: count ?? 0 })
}
