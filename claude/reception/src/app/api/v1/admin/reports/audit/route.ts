import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import React, { type ReactElement, type JSXElementConstructor } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { registerFonts } from '@/lib/pdf/fonts'
import { AuditReportPDF } from '@/lib/pdf/audit-report'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { storeId, dateFrom, dateTo } = body as {
    storeId: string | null
    dateFrom: string   // 'YYYY-MM-DD'
    dateTo: string     // 'YYYY-MM-DD'
  }

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'dateFrom と dateTo は必須です' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id

  // dateTo は当日含むため翌日00:00まで
  const dateToExclusive = new Date(dateTo)
  dateToExclusive.setDate(dateToExclusive.getDate() + 1)

  // 店舗名を取得
  let storeName = 'all'
  if (storeId) {
    const { data: store } = await supabase
      .from('stores')
      .select('name')
      .eq('id', storeId)
      .eq('tenant_id', tenantId)
      .single()
    storeName = store?.name ?? 'all'
  }

  // 来訪データを取得
  let query = supabase
    .from('visits')
    .select(`
      id, purpose, status, check_in_at, check_out_at,
      visitors(name, company, department),
      stores(name)
    `)
    .eq('tenant_id', tenantId)
    .gte('check_in_at', new Date(dateFrom).toISOString())
    .lt('check_in_at', dateToExclusive.toISOString())
    .order('check_in_at', { ascending: true })
    .limit(10000)

  if (storeId) {
    query = query.eq('store_id', storeId)
  }

  const { data, error } = await query

  if (error) {
    console.error('[reports/audit] Supabase error:', error)
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visits = (data ?? []).map((v: any) => ({
    id: v.id,
    purpose: v.purpose ?? '',
    status: v.status ?? '',
    check_in_at: v.check_in_at ?? '',
    check_out_at: v.check_out_at ?? null,
    visitor_name: v.visitors?.name ?? '',
    visitor_company: v.visitors?.company ?? '',
    visitor_department: v.visitors?.department ?? '',
    store_name: v.stores?.name ?? storeName,
  }))

  // フォント登録 + PDF生成
  registerFonts()

  const generatedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const element = React.createElement(AuditReportPDF, {
    storeName,
    dateFrom,
    dateTo,
    visits,
    generatedAt,
  }) as unknown as ReactElement<DocumentProps, string | JSXElementConstructor<DocumentProps>>

  const pdfBuffer = await renderToBuffer(element)

  // ファイル名
  const storeLabel = storeName === 'all' ? '全店舗' : storeName
  const fileName = encodeURIComponent(`来訪記録_${storeLabel}_${dateFrom}〜${dateTo}.pdf`)

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${fileName}`,
      'Content-Length': pdfBuffer.byteLength.toString(),
    },
  })
}
