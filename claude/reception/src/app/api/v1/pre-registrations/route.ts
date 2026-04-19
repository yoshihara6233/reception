import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/v1/pre-registrations?token=xxx
// Used by visitor-facing /pre/[token] page
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('pre_registrations')
    .select(`
      id,
      visitor_company,
      visitor_name,
      visitor_email,
      visitor_phone,
      purpose,
      token,
      expires_at,
      used_at,
      cancelled_at,
      contact_person_id,
      areas(id, name, qr_token, is_active),
      stores(id, name)
    `)
    .eq('token', token)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: '事前登録が見つかりません' },
      { status: 404 }
    )
  }

  // Validate state
  if (data.cancelled_at) {
    return NextResponse.json({ error: 'この事前登録はキャンセルされています', code: 'cancelled' }, { status: 410 })
  }
  if (data.used_at) {
    return NextResponse.json({ error: 'この事前登録は既に使用済みです', code: 'used' }, { status: 410 })
  }
  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'この事前登録は有効期限が切れています', code: 'expired' }, { status: 410 })
  }

  const area = data.areas as unknown as { id: string; name: string; qr_token: string; is_active: boolean }
  const store = data.stores as unknown as { id: string; name: string }

  if (!area?.is_active) {
    return NextResponse.json({ error: '受付エリアが無効です', code: 'inactive' }, { status: 410 })
  }

  return NextResponse.json({
    preRegistration: {
      id: data.id,
      visitorCompany: data.visitor_company,
      visitorName: data.visitor_name,
      visitorEmail: data.visitor_email,
      visitorPhone: data.visitor_phone,
      purpose: data.purpose,
      contactPersonId: data.contact_person_id,
      expiresAt: data.expires_at,
      areaQrToken: area.qr_token,
      areaName: area.name,
      storeName: store.name,
    }
  })
}
