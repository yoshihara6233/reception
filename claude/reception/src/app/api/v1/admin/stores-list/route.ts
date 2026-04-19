import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

  const { data } = await supabase
    .from('stores')
    .select('*, areas(id, name, qr_token, is_active)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ stores: data ?? [] })
}
