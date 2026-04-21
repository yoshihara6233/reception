import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, visitorId, preToken } = body

    if (!token) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 400 })
    }

    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }

    const supabase = createAdminClient()
    const deviceToken = req.headers.get('x-device-token')

    let visitToCheckout: { id: string; visitor_id: string } | null = null

    // Priority 1: visitorId (face auth checkout)
    if (visitorId) {
      const { data } = await supabase
        .from('visits')
        .select('id, visitor_id')
        .eq('visitor_id', visitorId)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })
        .limit(1)
        .single()

      if (!data) {
        return NextResponse.json({ error: '入室記録が見つかりません' }, { status: 404 })
      }
      visitToCheckout = data

    // Priority 2: preToken (QR scan checkout)
    } else if (preToken) {
      const { data: pre } = await supabase
        .from('pre_registrations')
        .select('visitor_id')
        .eq('pre_token', preToken)
        .eq('tenant_id', qr.tenantId!)
        .maybeSingle()

      if (!pre?.visitor_id) {
        return NextResponse.json({ error: '事前登録が見つかりません' }, { status: 404 })
      }

      const { data } = await supabase
        .from('visits')
        .select('id, visitor_id')
        .eq('visitor_id', pre.visitor_id)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })
        .limit(1)
        .single()

      if (!data) {
        return NextResponse.json({ error: '入室記録が見つかりません' }, { status: 404 })
      }
      visitToCheckout = data

    // Priority 3: deviceToken / area fallback
    } else {
      const { data: visits } = await supabase
        .from('visits')
        .select('id, visitor_id, visitors(device_token)')
        .eq('area_id', qr.areaId!)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })

      if (!visits || visits.length === 0) {
        return NextResponse.json(
          { error: '入室記録が見つかりません' },
          { status: 404 }
        )
      }

      visitToCheckout = visits[0]
      if (deviceToken) {
        const matched = visits.find(
          (v: any) => v.visitors?.device_token === deviceToken
        )
        if (matched) visitToCheckout = matched
      }
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
