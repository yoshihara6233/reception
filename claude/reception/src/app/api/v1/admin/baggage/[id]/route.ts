/**
 * GET /api/v1/admin/baggage/[id]
 *
 * Returns baggage declaration detail including:
 *  - VMS inspection info (hls_url, inspection_id)
 *  - Camera slots for the associated store
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const admin = createAdminClient()

  // Fetch declaration with VMS fields
  const { data: decl, error } = await admin
    .from('baggage_declarations')
    .select(`
      id,
      visit_id,
      tenant_id,
      context,
      declaration_text,
      inspection_mode,
      status,
      vms_inspection_id,
      vms_hls_url,
      inspection_started_at,
      inspection_ended_at,
      created_at,
      visits!inner(store_id)
    `)
    .eq('id', id)
    .single()

  if (error || !decl) {
    return NextResponse.json({ error: '申告が見つかりません' }, { status: 404 })
  }

  const storeId = Array.isArray(decl.visits)
    ? (decl.visits[0] as { store_id: string })?.store_id
    : (decl.visits as { store_id: string } | null)?.store_id

  // Fetch camera slots for this store
  let cameras: unknown[] = []
  if (storeId) {
    const { data: slots } = await admin
      .from('store_cameras')
      .select('slot, label, ipro_camera_id, vms_camera_id, is_active')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('slot')

    cameras = (slots || []).map(s => ({
      slot: s.slot,
      label: s.label,
      cameraId: s.vms_camera_id || s.ipro_camera_id || `cam-${s.slot}`,
      hlsUrl: decl.vms_hls_url || null,
    }))
  }

  return NextResponse.json({
    id: decl.id,
    visit_id: decl.visit_id,
    context: decl.context,
    declaration_text: decl.declaration_text,
    inspection_mode: decl.inspection_mode,
    status: decl.status,
    vms_inspection_id: decl.vms_inspection_id,
    vms_hls_url: decl.vms_hls_url,
    inspection_started_at: decl.inspection_started_at,
    cameras,
  })
}
