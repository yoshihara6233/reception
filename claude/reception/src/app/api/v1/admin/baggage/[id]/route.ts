/**
 * GET /api/v1/admin/baggage/[id]
 *
 * Returns baggage declaration detail including:
 *  - VMS inspection info (hls_url, inspection_id)
 *  - Camera slots for the associated store, each with resolved HLS URL
 *
 * HLS URL resolution order (per camera):
 *   1. vms_hls_url already stored in DB (set at inspection time)
 *   2. vms.getVodUrl(camera, inspection_started_at, inspection_ended_at)
 *      → OSS-VMS GET /api/v1/recordings?camera=X&from=unix&to=unix
 *      → returns Frigate nginx-vod-module HLS URL with HMAC access_token
 *
 * API key never leaves the server. HLS URLs are auth-free and safe to return.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { createVmsClientFromSettings } from '@/lib/vms/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    _debug?: string
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

    console.log(`[baggage/${id}] storeId=${storeId} vmsConnected=${vmsConnected} slots=${slots?.length ?? 0} inspection_started_at=${decl.inspection_started_at} vms_hls_url_stored=${!!decl.vms_hls_url}`)

    cameras = await Promise.all(
      (slots || []).map(async s => {
        const cameraId = s.vms_camera_id || s.ipro_camera_id || `cam-${s.slot}`
        let hlsUrl: string | null = null
        let debugNote = ''

        const canCallVod = Boolean(vms && decl.inspection_started_at && (s.vms_camera_id || s.ipro_camera_id))

        if (!vms) {
          debugNote = 'vms_not_configured'
        } else if (!decl.inspection_started_at) {
          debugNote = 'no_inspection_started_at'
        } else if (!s.vms_camera_id && !s.ipro_camera_id) {
          debugNote = 'no_camera_id_in_store_cameras'
        }

        // 1. On-demand via getVodUrl — always preferred: returns fresh access_token
        if (canCallVod) {
          try {
            const result = await vms!.getVodUrl(
              cameraId,
              decl.inspection_started_at!,
              decl.inspection_ended_at ?? undefined,
            )
            hlsUrl = result.hls_url || null
            debugNote = hlsUrl ? 'vodUrl_ok' : 'vodUrl_returned_empty'
            console.log(`[baggage/${id}] cam=${cameraId} getVodUrl → ${hlsUrl ? hlsUrl.slice(0, 80) : 'null'}`)
          } catch (e) {
            debugNote = `vodUrl_error: ${e instanceof Error ? e.message : String(e)}`
            console.error(`[baggage/${id}] cam=${cameraId} getVodUrl failed:`, e)
          }
        }

        // 2. Fallback: stored URL (may have expired token, but better than nothing)
        if (!hlsUrl && decl.vms_hls_url) {
          hlsUrl = decl.vms_hls_url
          debugNote += '+fallback_stored_url'
          console.log(`[baggage/${id}] cam=${cameraId} using stored vms_hls_url (may be expired)`)
        }

        if (!hlsUrl) {
          console.log(`[baggage/${id}] cam=${cameraId} no hlsUrl available. debug=${debugNote}`)
        }

        return { slot: s.slot, label: s.label, cameraId, hlsUrl, _debug: debugNote || 'unknown' }
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
    cameras: cameras.map(({ _debug, ...c }) => ({ ...c, _debug })),
  })
}
