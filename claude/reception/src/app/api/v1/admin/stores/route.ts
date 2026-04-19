import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateQrToken } from '@/lib/qr/generate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001'
  const { data } = await supabase
    .from('stores')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  return NextResponse.json({ stores: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, address } = body
    const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

    if (!name?.trim()) {
      return NextResponse.json({ error: '店舗名は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Create store
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({ tenant_id: tenantId, name: name.trim(), address: address?.trim() || null })
      .select('id')
      .single()

    if (storeError) {
      return NextResponse.json({ error: storeError.message }, { status: 500 })
    }

    // Create default area with QR token
    const qrToken = generateQrToken()
    const { error: areaError } = await supabase
      .from('areas')
      .insert({
        store_id: store.id,
        tenant_id: tenantId,
        name: 'バックヤード入口',
        qr_token: qrToken,
      })

    if (areaError) {
      return NextResponse.json({ error: areaError.message }, { status: 500 })
    }

    return NextResponse.json({ storeId: store.id, qrToken })
  } catch (err) {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
