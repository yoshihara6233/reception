import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

// GET /api/v1/areas/[token]/staff
// Returns active staff members for the visitor contact-person suggestion dropdown
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const qr = await validateQrToken(token)
  if (!qr.valid) {
    return NextResponse.json({ error: qr.error }, { status: 403 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('staff_members')
    .select('id, name, name_kana, email')
    .eq('tenant_id', qr.tenantId!)
    .eq('is_active', true)
    .or(`store_id.eq.${qr.storeId},store_id.is.null`)
    .order('name')
    .limit(100)

  if (error) return NextResponse.json({ staff: [] })
  return NextResponse.json({ staff: data ?? [] })
}
