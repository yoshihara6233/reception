import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { generateQrToken, getQrUrl } from '@/lib/qr/generate'

// Regenerate QR token for an area
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { areaId } = body

    if (!areaId) {
      return NextResponse.json({ error: 'areaIdが必要です' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const newToken = generateQrToken()

    // VULN-006 FIX: Scope update to caller's tenant — prevents rotating another tenant's QR
    const { error } = await supabase
      .from('areas')
      .update({ qr_token: newToken })
      .eq('id', areaId)
      .eq('tenant_id', ctx.tenant_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return NextResponse.json({
      qrToken: newToken,
      qrUrl: getQrUrl(newToken, baseUrl),
    })
  } catch (err) {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
