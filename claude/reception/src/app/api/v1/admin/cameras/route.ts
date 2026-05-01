import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

// GET /api/v1/admin/cameras?storeId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const storeId = req.nextUrl.searchParams.get('storeId')
  if (!storeId) return NextResponse.json({ error: 'storeId is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('store_cameras')
    .select('*')
    .eq('tenant_id', ctx.tenant_id)
    .eq('store_id', storeId)
    .order('slot')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cameras: data ?? [] })
}

// POST /api/v1/admin/cameras — create (upsert by slot)
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { storeId, slot, label, iproCameraId, iproRecorderId } = body

  if (!storeId) return NextResponse.json({ error: 'storeId is required' }, { status: 400 })
  if (!slot || slot < 1 || slot > 2) return NextResponse.json({ error: 'slot must be 1 or 2' }, { status: 400 })
  if (!label?.trim()) return NextResponse.json({ error: 'ラベルは必須です' }, { status: 400 })
  if (!iproCameraId?.trim()) return NextResponse.json({ error: 'i-PROカメラIDは必須です' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('store_cameras')
    .upsert({
      tenant_id: ctx.tenant_id,
      store_id: storeId,
      slot,
      label: label.trim(),
      ipro_camera_id: iproCameraId.trim(),
      ipro_recorder_id: iproRecorderId?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'store_id,slot' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ camera: data }, { status: 201 })
}

// PATCH /api/v1/admin/cameras?id=xxx — update
export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const body = await req.json()
  const { label, iproCameraId, iproRecorderId, isActive } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (label !== undefined) updates.label = label.trim()
  if (iproCameraId !== undefined) updates.ipro_camera_id = iproCameraId.trim()
  if (iproRecorderId !== undefined) updates.ipro_recorder_id = iproRecorderId?.trim() || null
  if (isActive !== undefined) updates.is_active = isActive

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('store_cameras')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', ctx.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/v1/admin/cameras?id=xxx
export async function DELETE(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('store_cameras')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
