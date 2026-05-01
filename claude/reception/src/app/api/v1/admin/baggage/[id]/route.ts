/**
 * GET /api/v1/admin/baggage/[id]
 *
 * Returns baggage declaration detail including:
 *  - VMS inspection info (hls_url, inspection_id)
 *  - Camera slots for the associated store, each with resolved HLS URL
 *
 * HLS URL resolution order (per camera):
 *   1. vms_hls_url already stored in DB (set at inspection time)
 *   2. vms.getInspection(inspection_id) if inspection_id is stored
 *   3. vms.getRecordings(camera, from, to) using inspection_started_at + 1h window
 *
 * API key never leaves the server. HLS URLs are auth-free and safe to return.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClientFromSettings } from '@/lib/vms/client'

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

  // Fetch camera slots + store VMS settings
  let cameras: {
    slot: number
    label: string
    cameraId: string
    hlsUrl: string | null
  }[] = []
  let vmsConnected = false

  if (storeId) {
    const [{ data: slots }, { data: store }] = await Promise.all([
      admin
        .from('store_cameras')
        .select('slot, label, ipro_camera_id, vms_camera_id, is_active')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('slot'),
      admin
        .from('stores')
        .select('settings')
        .eq('id', storeId)
        .single(),
    ])

    const settings = store?.settings as {
      vms_url?: string
      vms_api_key?: string
      vms_enabled?: boolean
    } | null

    const vms = createVmsClientFromSettings(settings)
    vmsConnected = Boolean(vms)

    // Resolve HLS URL for each camera slot
    cameras = await Promise.all(
      (slots || []).map(async s => {
        const cameraId = s.vms_camera_id || s.ipro_camera_id || `cam-${s.slot}`
        let hlsUrl: string | null = null

        // 1. Already stored in DB
        if (decl.vms_hls_url) {
          hlsUrl = decl.vms_hls_url

        // 2. Re-fetch via inspection_id
        } else if (vms && decl.vms_inspection_id) {
          try {
            const insp = await vms.getInspection(decl.vms_inspection_id)
            hlsUrl = insp.hls_url || null
          } catch { /* non-fatal */ }

        // 3. On-demand via getRecordings (for past inspections)
        } else if (vms && decl.inspection_started_at && (s.vms_camera_id || s.ipro_camera_id)) {
          try {
            const from = decl.inspection_started_at
            const to = new Date(new Date(from).getTime() + 60 * 60 * 1000).toISOString() // +1h
            const recordings = await vms.getRecordings({ camera: cameraId, from, to })
            hlsUrl = recordings?.[0]?.hls_url || null
          } catch { /* non-fatal */ }
        }

        return { slot: s.slot, label: s.label, cameraId, hlsUrl }
      })
    )
  }

  const resolvedHlsUrl = cameras.find(c => c.hlsUrl)?.hlsUrl || decl.vms_hls_url || null

  return NextResponse.json({
    id: decl.id,
    visit_id: decl.visit_id,
    context: decl.context,
    declaration_text: decl.declaration_text,
    inspection_mode: decl.inspection_mode,
    status: decl.status,
    vms_inspection_id: decl.vms_inspection_id,
    vms_hls_url: resolvedHlsUrl,
    inspection_started_at: decl.inspection_started_at,
    inspection_ended_at: decl.inspection_ended_at,
    vms_connected: vmsConnected,
    cameras,
  })
}
