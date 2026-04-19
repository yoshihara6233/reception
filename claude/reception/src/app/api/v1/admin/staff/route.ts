import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

// GET /api/v1/admin/staff?storeId=&active=true
export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const storeId = req.nextUrl.searchParams.get('storeId')
  const activeOnly = req.nextUrl.searchParams.get('active') !== 'false'

  let query = supabase
    .from('staff_members')
    .select('*')
    .eq('tenant_id', ctx.tenant_id)
    .order('name')

  if (activeOnly) query = query.eq('is_active', true)
  if (storeId) query = query.or(`store_id.eq.${storeId},store_id.is.null`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ staff: data })
}

// POST /api/v1/admin/staff
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, name_kana, email, slack_member_id, store_id } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: '名前は必須です' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('staff_members')
    .insert({
      tenant_id: ctx.tenant_id,
      name: name.trim(),
      name_kana: name_kana?.trim() || null,
      email: email?.trim() || null,
      slack_member_id: slack_member_id?.trim() || null,
      store_id: store_id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data }, { status: 201 })
}

// PATCH /api/v1/admin/staff?id=
export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('staff_members')
    .update({
      name: body.name?.trim(),
      name_kana: body.name_kana?.trim() || null,
      email: body.email?.trim() || null,
      slack_member_id: body.slack_member_id?.trim() || null,
      store_id: body.store_id || null,
      is_active: body.is_active ?? true,
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenant_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}

// DELETE /api/v1/admin/staff?id= (soft delete)
export async function DELETE(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = createAdminClient()
  await supabase
    .from('staff_members')
    .update({ is_active: false })
    .eq('id', id)
    .eq('tenant_id', ctx.tenant_id)

  return NextResponse.json({ ok: true })
}
