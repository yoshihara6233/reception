import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { VisitDetailClient } from './visit-detail-client'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

async function makeSignedUrl(supabase: ReturnType<typeof createAdminClient>, path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('visit-photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export default async function VisitDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: visit } = await supabase
    .from('visits')
    .select(`
      *,
      visitors(*),
      stores(name),
      areas(name),
      visit_photos(*),
      baggage_declarations(
        id, context, inspection_mode, declaration_text, status,
        photo_path_contents, photo_path_empty, staff_notes, reviewed_at
      )
    `)
    .eq('id', id)
    .single()

  if (!visit) notFound()

  const visitor = visit.visitors as any
  const photos = (visit.visit_photos as any[]) || []

  // 来訪者写真（顔・名刺）の signed URL
  const photosWithUrls = await Promise.all(
    photos.map(async (photo: any) => {
      const url = await makeSignedUrl(supabase, photo.storage_path)
      return {
        id: photo.id,
        type: photo.type,
        signedUrl: url,
        ocrResult: photo.ocr_result ?? null,
      }
    })
  )

  // 手荷物写真の signed URL（contents + empty を並列取得）
  const baggageDeclarations = await Promise.all(
    ((visit.baggage_declarations as any[]) || []).map(async (bd: any) => {
      const [contentsUrl, emptyUrl] = await Promise.all([
        makeSignedUrl(supabase, bd.photo_path_contents),
        makeSignedUrl(supabase, bd.photo_path_empty),
      ])
      return {
        id: bd.id,
        context: bd.context as 'checkin' | 'checkout',
        inspection_mode: bd.inspection_mode as 'photo' | 'video' | null,
        declaration_text: bd.declaration_text as string | null,
        status: bd.status as string,
        staff_notes: bd.staff_notes as string | null,
        reviewed_at: bd.reviewed_at as string | null,
        photoContentsUrl: contentsUrl,
        photoEmptyUrl: emptyUrl,
      }
    })
  )

  return (
    <VisitDetailClient
      visitId={id}
      visitorName={visitor?.name ?? ''}
      visitorCompany={[visitor?.company, visitor?.department].filter(Boolean).join(' / ')}
      visitInfo={{
        purpose: visit.purpose,
        storeName: (visit.stores as any)?.name,
        areaName:  (visit.areas as any)?.name,
        checkInAt:  visit.check_in_at,
        checkOutAt: visit.check_out_at,
        phone: visitor?.phone,
        email: visitor?.email,
        status: visit.status,
      }}
      photos={photosWithUrls}
      baggageDeclarations={baggageDeclarations}
    />
  )
}
