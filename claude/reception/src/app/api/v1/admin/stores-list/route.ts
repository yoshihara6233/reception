import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id

  const { data } = await supabase
    .from('stores')
    .select('*, areas(id, name, qr_token, is_active)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ stores: data ?? [] })
}
