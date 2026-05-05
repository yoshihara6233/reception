/**
 * GET /api/v1/admin/visits/[id]
 *
 * Returns full visit detail with signed photo URLs — used by the inline
 * detail panel in the split-pane visits list view.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

async function makeSignedUrl(
  supabase: ReturnType<typeof createAdminClient>,
  path: string | null
): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('visit-photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createAdminClient()

  const { data: visit, error } = await supabase
    .from('visits')
    .select(`
      id, purpose, status, check_in_at, check_out_at,
      visitors(id, name, company, department, phone, email),
      stores(name),
      areas(name),
      visit_photos(id, type, storage_path, ocr_result),
      baggage_declarations(
        id, context, inspection_mode, declaration_text, status,
        photo_path_contents, photo_path_empty, staff_notes, reviewed_at,
        vms_inspection_id, vms_hls_url, inspection_started_at, inspection_ended_at
      )
    `)
    .eq('id', id)
    .single()

  if (error || !visit) {
    return NextResponse.json({ error: '来訪記録が見つかりません' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitor = visit.visitors as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photos  = (visit.visit_photos as any[]) || []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baggage = (visit.baggage_declarations as any[]) || []

  // Signed URLs for visitor photos
  const photosWithUrls = await Promise.all(
    photos.map(async (p: any) => ({
      id:        p.id,
      type:      p.type,
      signedUrl: await makeSignedUrl(supabase, p.storage_path),
      ocrResult: p.ocr_result ?? null,
    }))
  )

  // Signed URLs for baggage photos
  const baggageWithUrls = await Promise.all(
    baggage.map(async (bd: any) => {
      const [contentsUrl, emptyUrl] = await Promise.all([
        makeSignedUrl(supabase, bd.photo_path_contents),
        makeSignedUrl(supabase, bd.photo_path_empty),
      ])
      return {
        id:                    bd.id,
        context:               bd.context,
        inspection_mode:       bd.inspection_mode,
        declaration_text:      bd.declaration_text,
        status:                bd.status,
        staff_notes:           bd.staff_notes,
        reviewed_at:           bd.reviewed_at,
        vms_inspection_id:     bd.vms_inspection_id,
        vms_hls_url:           bd.vms_hls_url,
        inspection_started_at: bd.inspection_started_at,
        inspection_ended_at:   bd.inspection_ended_at,
        photoContentsUrl:      contentsUrl,
        photoEmptyUrl:         emptyUrl,
      }
    })
  )

  return NextResponse.json({
    id:          visit.id,
    purpose:     visit.purpose,
    status:      visit.status,
    check_in_at: visit.check_in_at,
    check_out_at: visit.check_out_at,
    visitor: visitor ? {
      id:         visitor.id,
      name:       visitor.name,
      company:    visitor.company,
      department: visitor.department,
      phone:      visitor.phone,
      email:      visitor.email,
    } : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store_name: (visit.stores as any)?.name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    area_name:  (visit.areas  as any)?.name ?? null,
    photos:     photosWithUrls,
    baggage:    baggageWithUrls,
  })
}
