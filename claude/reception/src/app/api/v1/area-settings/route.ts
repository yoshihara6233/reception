/**
 * GET /api/v1/area-settings?token=<qr_token>
 * 来訪者フロー用: QRトークンから店舗設定（テナント設定 + 店舗上書き）を返す
 * 認証不要 (公開エンドポイント) — 機密情報は含まない
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SETTINGS = {
  require_business_card: 'optional',
  require_face_photo: 'optional',
  visit_purposes: ['定期配送', 'メンテナンス', '商談', '監査', 'その他'],
  require_baggage_inspection_checkin: 'none',
  require_baggage_inspection_checkout: 'none',
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // QRトークンからエリア・店舗・テナントを取得
  const { data: area, error } = await supabase
    .from('areas')
    .select('id, store_id, tenant_id, name, stores(name, settings), stores!inner(tenant_id)')
    .eq('qr_token', token)
    .eq('is_active', true)
    .single()

  if (error || !area) {
    return NextResponse.json({ settings: DEFAULT_SETTINGS })
  }

  // テナント設定を取得
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', area.tenant_id)
    .single()

  const tenantSettings = (tenant?.settings as Record<string, unknown>) || {}
  const storeData = area.stores as unknown as { name: string; settings: Record<string, unknown> } | null
  const storeSettings = storeData?.settings || {}

  // テナント設定 → 店舗設定でマージ（公開して良い項目のみ）
  const merged = {
    require_business_card:
      storeSettings.require_business_card ??
      tenantSettings.require_business_card ??
      DEFAULT_SETTINGS.require_business_card,
    require_face_photo:
      storeSettings.require_face_photo ??
      tenantSettings.require_face_photo ??
      DEFAULT_SETTINGS.require_face_photo,
    visit_purposes:
      storeSettings.visit_purposes ??
      tenantSettings.visit_purposes ??
      DEFAULT_SETTINGS.visit_purposes,
    require_baggage_inspection_checkin:
      storeSettings.require_baggage_inspection_checkin ??
      tenantSettings.require_baggage_inspection_checkin ??
      DEFAULT_SETTINGS.require_baggage_inspection_checkin,
    require_baggage_inspection_checkout:
      storeSettings.require_baggage_inspection_checkout ??
      tenantSettings.require_baggage_inspection_checkout ??
      DEFAULT_SETTINGS.require_baggage_inspection_checkout,
  }

  return NextResponse.json({ settings: merged })
}
