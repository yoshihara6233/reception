import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('admin_users')
    .select('*')
    .eq('tenant_id', ctx.tenant_id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ users: data ?? [] })
}
