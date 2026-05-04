/**
 * GET /api/v1/cron/data-retention
 *
 * Vercel Cron Job: runs daily at 02:00 JST (17:00 UTC).
 * Deletes visits and photos older than the tenant's configured retention period.
 *
 * vercel.json schedule: "0 17 * * *"
 *
 * Deletion order (FK constraints):
 *   1. visit_photos (storage + DB rows)
 *   2. visits
 *
 * Tenant settings (tenants.settings JSONB):
 *   photo_retention_days  — photos older than this are deleted (default: 90)
 *   visit_retention_days  — visits older than this are deleted (default: 365)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Fetch all tenants and their retention settings
  const { data: tenants, error: tenantError } = await supabase
    .from('tenants')
    .select('id, settings')

  if (tenantError || !tenants) {
    console.error('[data-retention] Failed to fetch tenants:', tenantError)
    return NextResponse.json({ error: 'Failed to fetch tenants' }, { status: 500 })
  }

  const results: Array<{
    tenant_id: string
    photos_deleted: number
    visits_deleted: number
    errors: string[]
  }> = []

  for (const tenant of tenants) {
    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    const photoRetentionDays = Number(settings.photo_retention_days) || 90
    const visitRetentionDays = Number(settings.visit_retention_days) || 365

    const errors: string[] = []
    let photosDeleted = 0
    let visitsDeleted = 0

    const photoCutoff = new Date(Date.now() - photoRetentionDays * 86_400_000).toISOString()
    const visitCutoff = new Date(Date.now() - visitRetentionDays * 86_400_000).toISOString()

    // --- 1. Delete old photos (storage paths first, then DB rows) ---
    const { data: oldPhotos, error: photoFetchError } = await supabase
      .from('visit_photos')
      .select('id, storage_path')
      .eq('tenant_id', tenant.id)
      .lt('created_at', photoCutoff)

    if (photoFetchError) {
      errors.push(`photo fetch: ${photoFetchError.message}`)
    } else if (oldPhotos && oldPhotos.length > 0) {
      // Delete from Supabase Storage
      const storagePaths = oldPhotos.map(p => p.storage_path).filter(Boolean)
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('visit-photos')
          .remove(storagePaths)
        if (storageError) {
          errors.push(`storage delete: ${storageError.message}`)
        }
      }

      // Delete DB rows
      const { error: dbPhotoError } = await supabase
        .from('visit_photos')
        .delete()
        .in('id', oldPhotos.map(p => p.id))

      if (dbPhotoError) {
        errors.push(`photo db delete: ${dbPhotoError.message}`)
      } else {
        photosDeleted = oldPhotos.length
      }
    }

    // --- 2. Delete old visits (photos must be removed first) ---
    // Only delete visits that have no remaining photos (FK safety)
    const { data: oldVisits, error: visitFetchError } = await supabase
      .from('visits')
      .select('id')
      .eq('tenant_id', tenant.id)
      .lt('created_at', visitCutoff)
      .not('status', 'eq', 'checked_in')  // never delete active visits

    if (visitFetchError) {
      errors.push(`visit fetch: ${visitFetchError.message}`)
    } else if (oldVisits && oldVisits.length > 0) {
      const { error: visitDeleteError } = await supabase
        .from('visits')
        .delete()
        .in('id', oldVisits.map(v => v.id))

      if (visitDeleteError) {
        errors.push(`visit delete: ${visitDeleteError.message}`)
      } else {
        visitsDeleted = oldVisits.length
      }
    }

    results.push({
      tenant_id: tenant.id,
      photos_deleted: photosDeleted,
      visits_deleted: visitsDeleted,
      errors,
    })

    if (errors.length > 0) {
      console.error(`[data-retention] tenant=${tenant.id} errors:`, errors)
    }
  }

  const totalPhotos = results.reduce((s, r) => s + r.photos_deleted, 0)
  const totalVisits = results.reduce((s, r) => s + r.visits_deleted, 0)
  const hasErrors = results.some(r => r.errors.length > 0)

  console.log(`[data-retention] done: photos=${totalPhotos} visits=${totalVisits} tenants=${tenants.length}`)

  return NextResponse.json({
    ok: !hasErrors,
    summary: { photos_deleted: totalPhotos, visits_deleted: totalVisits, tenants: tenants.length },
    results,
  })
}
