import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// GET /api/v1/admin/pre-registrations
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const storeId = searchParams.get('storeId')

  let query = supabase
    .from('pre_registrations')
    .select(`
      id, visitor_company, visitor_name, visitor_email, visitor_phone,
      purpose, token, expires_at, used_at, cancelled_at, created_at,
      stores(id, name),
      areas(id, name),
      staff_members(id, name)
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (storeId) query = query.eq('store_id', storeId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ preRegistrations: data || [] })
}

// POST /api/v1/admin/pre-registrations — create new pre-registration
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const {
    visitorCompany,
    visitorName,
    visitorEmail,
    visitorPhone,
    purpose,
    contactPersonId,
    storeId,
    areaId,
    expiresInHours = 48,
  } = body

  if (!visitorCompany?.trim() || !visitorName?.trim() || !purpose?.trim() || !storeId || !areaId) {
    return NextResponse.json({ error: '必須項目が入力されていません' }, { status: 400 })
  }

  // Get current admin user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('pre_registrations')
    .insert({
      tenant_id: adminUser.tenant_id,
      store_id: storeId,
      area_id: areaId,
      host_user_id: adminUser.id,
      visitor_company: visitorCompany.trim(),
      visitor_name: visitorName.trim(),
      visitor_email: visitorEmail?.trim() || null,
      visitor_phone: visitorPhone?.trim() || null,
      purpose: purpose.trim(),
      contact_person_id: contactPersonId || null,
      expires_at: expiresAt,
    })
    .select('id, token')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || '作成に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, token: data.token }, { status: 201 })
}

// PATCH /api/v1/admin/pre-registrations — cancel
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { id } = await req.json()

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('pre_registrations')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .is('cancelled_at', null)
    .is('used_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
