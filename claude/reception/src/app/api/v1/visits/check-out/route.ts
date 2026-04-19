import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 400 })
    }

    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }

    const supabase = createAdminClient()
    const deviceToken = req.headers.get('x-device-token')

    // Find active visit at this area
    let query = supabase
      .from('visits')
      .select('id, visitor_id, visitors(device_token)')
      .eq('area_id', qr.areaId!)
      .eq('tenant_id', qr.tenantId!)
      .eq('status', 'checked_in')
      .order('check_in_at', { ascending: false })

    const { data: visits } = await query

    if (!visits || visits.length === 0) {
      return NextResponse.json(
        { error: '入室記録が見つかりません' },
        { status: 404 }
      )
    }

    // Try to match by device token first, otherwise use most recent visit
    let visitToCheckout = visits[0]
    if (deviceToken) {
      const matched = visits.find(
        (v: any) => v.visitors?.device_token === deviceToken
      )
      if (matched) visitToCheckout = matched
    }

    // Update visit status
    const { error: updateError } = await supabase
      .from('visits')
      .update({
        status: 'checked_out',
        check_out_at: new Date().toISOString(),
      })
      .eq('id', visitToCheckout.id)

    if (updateError) {
      console.error('Checkout error:', updateError)
      return NextResponse.json(
        { error: '退室処理に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, visitId: visitToCheckout.id })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
