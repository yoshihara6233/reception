import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { count } = await supabase
    .from('baggage_declarations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenant_id)
    .in('status', ['pending', 'flagged'])

  return NextResponse.json({ count: count ?? 0 })
}
