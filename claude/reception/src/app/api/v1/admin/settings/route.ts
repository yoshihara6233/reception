import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

/**
 * GET /api/v1/admin/settings
 *   ?storeId=<uuid>  → 店舗設定（テナント設定をベースに店舗設定で上書き）
 *   (no storeId)     → テナント共通設定
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createAdminClient()
    const storeId = req.nextUrl.searchParams.get('storeId')

    // テナント共通設定を取得
    const { data: tenant } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', ctx.tenant_id)
      .single()

    const tenantSettings = (tenant?.settings as Record<string, unknown>) || {}

    if (!storeId) {
      return NextResponse.json({ settings: tenantSettings, scope: 'tenant' })
    }

    // 店舗設定を取得（テナント設定にマージして返す）
    const { data: store } = await supabase
      .from('stores')
      .select('settings')
      .eq('id', storeId)
      .eq('tenant_id', ctx.tenant_id)
      .single()

    const storeSettings = (store?.settings as Record<string, unknown>) || {}

    // テナント設定をベースに、店舗設定で上書き
    const merged = { ...tenantSettings, ...storeSettings }

    return NextResponse.json({
      settings: merged,
      tenantSettings,
      storeSettings,
      scope: 'store',
    })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

/**
 * PUT /api/v1/admin/settings
 *   ?storeId=<uuid>  → 店舗設定のみを更新（テナント設定は触らない）
 *   (no storeId)     → テナント共通設定を更新
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = createAdminClient()
    const storeId = req.nextUrl.searchParams.get('storeId')

    if (!storeId) {
      // テナント共通設定を更新
      const { data: tenant } = await supabase
        .from('tenants')
        .select('settings')
        .eq('id', ctx.tenant_id)
        .single()

      const currentSettings = (tenant?.settings as Record<string, unknown>) || {}
      const newSettings = { ...currentSettings, ...body }

      const { error } = await supabase
        .from('tenants')
        .update({ settings: newSettings, updated_at: new Date().toISOString() })
        .eq('id', ctx.tenant_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, settings: newSettings, scope: 'tenant' })
    }

    // 店舗設定を更新（店舗固有フィールドのみ保存）
    const { data: store } = await supabase
      .from('stores')
      .select('settings')
      .eq('id', storeId)
      .eq('tenant_id', ctx.tenant_id)
      .single()

    if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })

    const currentStoreSettings = (store.settings as Record<string, unknown>) || {}
    const newStoreSettings = { ...currentStoreSettings, ...body }

    const { error } = await supabase
      .from('stores')
      .update({ settings: newStoreSettings })
      .eq('id', storeId)
      .eq('tenant_id', ctx.tenant_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, settings: newStoreSettings, scope: 'store' })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/admin/settings?storeId=<uuid>&key=<field>
 * 店舗個別設定の特定フィールドをリセット（テナント共通設定に戻す）
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createAdminClient()
    const storeId = req.nextUrl.searchParams.get('storeId')
    const key = req.nextUrl.searchParams.get('key')

    if (!storeId || !key) {
      return NextResponse.json({ error: 'storeId and key are required' }, { status: 400 })
    }

    const { data: store } = await supabase
      .from('stores')
      .select('settings')
      .eq('id', storeId)
      .eq('tenant_id', ctx.tenant_id)
      .single()

    if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })

    const storeSettings = { ...(store.settings as Record<string, unknown>) }
    delete storeSettings[key]

    const { error } = await supabase
      .from('stores')
      .update({ settings: storeSettings })
      .eq('id', storeId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
