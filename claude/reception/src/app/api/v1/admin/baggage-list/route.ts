import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl

  const statusFilter  = searchParams.get('status') || ''
  const storeId       = searchParams.get('storeId') || ''
  const context       = searchParams.get('context') || ''       // 'checkin' | 'checkout'
  const visitorName   = searchParams.get('visitorName') || ''
  const company       = searchParams.get('company') || ''
  const dateFrom      = searchParams.get('dateFrom') || ''
  const dateTo        = searchParams.get('dateTo') || ''
  const sortDir       = searchParams.get('sortDir') === 'asc' ? true : false
  const page          = parseInt(searchParams.get('page') || '1')
  const perPage       = 20

  // RBAC: store_manager scoped to their store_ids
  const allowedStoreIds = ctx.role === 'store_manager' ? ctx.store_ids : null

  // If visitor name / company filter → resolve visit_ids via a sub-query
  let visitIdFilter: string[] | null = null

  if (visitorName || company || storeId || (allowedStoreIds && allowedStoreIds.length > 0)) {
    // Find matching visitor IDs
    let visitorIds: string[] | null = null
    if (visitorName || company) {
      let vq = supabase.from('visitors').select('id').eq('tenant_id', ctx.tenant_id)
      if (visitorName) vq = vq.ilike('name', `%${visitorName}%`)
      if (company)     vq = vq.ilike('company', `%${company}%`)
      const { data: vd } = await vq
      visitorIds = (vd ?? []).map((v: { id: string }) => v.id)
      if (visitorIds.length === 0) return NextResponse.json({ declarations: [], total: 0, stores: [] })
    }

    // Find matching visit IDs
    let visitsQ = supabase.from('visits').select('id').eq('tenant_id', ctx.tenant_id)
    if (visitorIds)                                          visitsQ = visitsQ.in('visitor_id', visitorIds)
    if (storeId)                                             visitsQ = visitsQ.eq('store_id', storeId)
    if (allowedStoreIds && allowedStoreIds.length > 0)       visitsQ = visitsQ.in('store_id', allowedStoreIds)
    const { data: vsd } = await visitsQ
    visitIdFilter = (vsd ?? []).map((v: { id: string }) => v.id)
    if (visitIdFilter.length === 0) return NextResponse.json({ declarations: [], total: 0, stores: [] })
  }

  // Main query
  let query = supabase
    .from('baggage_declarations')
    .select(
      `id, context, declaration_text, status, inspection_mode, photo_path_contents, photo_path_empty,
       staff_notes, reviewed_at, created_at,
       visits(id, check_in_at, check_out_at, purpose, stores(id, name),
              visitors(name, company),
              visit_photos(id, type, storage_path))`,
      { count: 'exact' }
    )
    .eq('tenant_id', ctx.tenant_id)
    .order('created_at', { ascending: sortDir })
    .range((page - 1) * perPage, page * perPage - 1)

  // Status filter
  // 'all'     = フィルターなし（全ステータス表示）
  // ''        = デフォルト（pending のみ = 未審査・要対応）
  // 'cleared' = 問題なし
  // 'flagged' = フラグ（審査済み・要注意）
  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  } else if (!statusFilter) {
    query = query.in('status', ['pending'])
  }

  // Context filter
  if (context) query = query.eq('context', context)

  // Date range — JST (+09:00) 基準で絞り込み
  if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+09:00`)
  if (dateTo)   query = query.lte('created_at', `${dateTo}T23:59:59+09:00`)

  // Visit ID filter (from visitor/store sub-query)
  if (visitIdFilter) query = query.in('visit_id', visitIdFilter)

  const { data, count } = await query

  // Generate signed URLs for photos
  const declarations = await Promise.all(
    (data ?? []).map(async (decl: Record<string, unknown>) => {
      let photoContentsUrl: string | null = null
      let photoEmptyUrl: string | null = null
      let facePhotoUrl: string | null = null
      let cardPhotoUrl: string | null = null

      if (decl.photo_path_contents) {
        const { data: signed } = await supabase.storage
          .from('visit-photos')
          .createSignedUrl(decl.photo_path_contents as string, 3600)
        photoContentsUrl = signed?.signedUrl ?? null
      }
      if (decl.photo_path_empty) {
        const { data: signed } = await supabase.storage
          .from('visit-photos')
          .createSignedUrl(decl.photo_path_empty as string, 3600)
        photoEmptyUrl = signed?.signedUrl ?? null
      }

      // visit_photos から顔写真・名刺写真の signed URL を生成
      const visits = decl.visits as Record<string, unknown> | null
      const visitPhotos = (visits?.visit_photos as Array<{ type: string; storage_path: string }>) ?? []
      for (const vp of visitPhotos) {
        const { data: signed } = await supabase.storage
          .from('visit-photos')
          .createSignedUrl(vp.storage_path, 3600)
        if (!signed?.signedUrl) continue
        if (vp.type === 'face' && !facePhotoUrl) facePhotoUrl = signed.signedUrl
        if (vp.type === 'card' && !cardPhotoUrl) cardPhotoUrl = signed.signedUrl
      }

      return { ...decl, photoContentsUrl, photoEmptyUrl, facePhotoUrl, cardPhotoUrl }
    })
  )

  // Return stores list for dropdown
  const { data: storesData } = await supabase
    .from('stores')
    .select('id, name')
    .eq('tenant_id', ctx.tenant_id)
    .eq('is_active', true)
    .order('name')

  return NextResponse.json({ declarations, total: count ?? 0, stores: storesData ?? [] })
}
