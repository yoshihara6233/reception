import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { VisitDetailClient } from './visit-detail-client'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function VisitDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: visit } = await supabase
    .from('visits')
    .select('*, visitors(*), stores(name), areas(name), visit_photos(*)')
    .eq('id', id)
    .single()

  if (!visit) notFound()

  const visitor = visit.visitors as any
  const photos = (visit.visit_photos as any[]) || []

  // Generate signed URLs server-side
  const photosWithUrls = await Promise.all(
    photos.map(async (photo: any) => {
      const { data } = await supabase.storage
        .from('visit-photos')
        .createSignedUrl(photo.storage_path, 3600)
      return {
        id: photo.id,
        type: photo.type,
        signedUrl: data?.signedUrl ?? null,
        ocrResult: photo.ocr_result ?? null,
      }
    })
  )

  return (
    <VisitDetailClient
      visitorName={visitor?.name ?? ''}
      visitorCompany={[visitor?.company, visitor?.department].filter(Boolean).join(' / ')}
      visitInfo={{
        purpose: visit.purpose,
        storeName: (visit.stores as any)?.name,
        areaName: (visit.areas as any)?.name,
        checkInAt: visit.check_in_at,
        checkOutAt: visit.check_out_at,
        phone: visitor?.phone,
        email: visitor?.email,
        status: visit.status,
      }}
      photos={photosWithUrls}
    />
  )
}
