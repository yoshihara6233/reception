import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateQrToken } from '@/lib/qr/generate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { storeId, name } = body
    const tenantId = '00000000-0000-0000-0000-000000000001'

    if (!storeId) return NextResponse.json({ error: 'storeIdが必要です' }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: 'エリア名は必須です' }, { status: 400 })

    const supabase = createAdminClient()
    const qrToken = generateQrToken()

    const { data, error } = await supabase
      .from('areas')
      .insert({ store_id: storeId, tenant_id: tenantId, name: name.trim(), qr_token: qrToken })
      .select('id, name, qr_token, is_active')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ area: data })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
