/**
 * GET  /api/v1/admin/stores/[id]/cameras
 * PUT  /api/v1/admin/stores/[id]/cameras
 *
 * Manage camera slots and VMS/i-PRO connection settings for a store.
 *
 * GET returns:
 *   { slots: CameraSlot[], vms_url, vms_enabled, ipro_client_id }
 *   (secrets/api_keys are never returned)
 *
 * PUT accepts:
 *   { slots, vms_url, vms_api_key, vms_enabled, ipro_client_id, ipro_client_secret }
 *
 * Camera slots are stored in store_cameras table (one row per slot).
 * VMS + i-PRO credentials are stored in stores.settings JSONB.
 * API keys are stored server-side only (never returned to client).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

interface CameraSlot {
  slot: 1 | 2
  label: string
  ipro_camera_id: string
  ipro_recorder_id: string
  vms_camera_id: string
  is_active: boolean
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storeId } = await params
  const admin = createAdminClient()

  // Fetch camera slots
  const { data: cameras } = await admin
    .from('store_cameras')
    .select('slot, label, ipro_camera_id, ipro_recorder_id, vms_camera_id, is_active')
    .eq('store_id', storeId)
    .order('slot')

  // Fetch store settings (return url + enabled flag, never the keys)
  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as Record<string, unknown> | null

  return NextResponse.json({
    slots: cameras || [],
    vms_url: settings?.vms_url || null,
    vms_enabled: settings?.vms_enabled || false,
    vms_has_key: !!(settings?.vms_api_key),
    ipro_client_id: settings?.ipro_client_id || null,
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storeId } = await params
  const admin = createAdminClient()
  const body = await req.json()

  const {
    slots,
    vms_url,
    vms_api_key,
    vms_enabled,
    ipro_client_id,
    ipro_client_secret,
  } = body

  // Camera slots: update existing rows or insert new ones
  // (avoid relying on unique constraint for upsert)
  if (Array.isArray(slots)) {
    for (const slot of slots as CameraSlot[]) {
      // Check if row already exists
      const { data: existing } = await admin
        .from('store_cameras')
        .select('id')
        .eq('store_id', storeId)
        .eq('slot', slot.slot)
        .maybeSingle()

      const rowData = {
        tenant_id: TENANT_ID,
        store_id: storeId,
        slot: slot.slot,
        label: slot.label,
        ipro_camera_id: slot.ipro_camera_id || '',
        ipro_recorder_id: slot.ipro_recorder_id || null,
        vms_camera_id: slot.vms_camera_id || null,
        is_active: slot.is_active,
      }

      if (existing) {
        const { error } = await admin
          .from('store_cameras')
          .update(rowData)
          .eq('id', existing.id)
        if (error) {
          console.error('[cameras PUT] update error:', error)
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      } else {
        const { error } = await admin
          .from('store_cameras')
          .insert(rowData)
        if (error) {
          console.error('[cameras PUT] insert error:', error)
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }
    }
  }

  // Update store settings — merge, don't overwrite the whole JSONB
  // Fetch current settings first
  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const currentSettings = (store?.settings as Record<string, unknown>) || {}

  const newSettings: Record<string, unknown> = {
    ...currentSettings,
    vms_enabled: vms_enabled ?? currentSettings.vms_enabled ?? false,
  }

  if (vms_url !== undefined) newSettings.vms_url = vms_url
  if (vms_api_key) newSettings.vms_api_key = vms_api_key  // only update if provided
  if (ipro_client_id !== undefined) newSettings.ipro_client_id = ipro_client_id
  if (ipro_client_secret) newSettings.ipro_client_secret = ipro_client_secret

  const { error: settingsErr } = await admin
    .from('stores')
    .update({ settings: newSettings })
    .eq('id', storeId)

  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
