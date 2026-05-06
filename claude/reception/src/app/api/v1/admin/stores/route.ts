import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateQrToken } from '@/lib/qr/generate'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id
  const { data } = await supabase
    .from('stores')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  return NextResponse.json({ stores: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { name, address } = body
    const tenantId = ctx.tenant_id

    if (!name?.trim()) {
      return NextResponse.json({ error: '店舗名は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Create store
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({ tenant_id: tenantId, name: name.trim(), address: address?.trim() || null })
      .select('id')
      .single()

    if (storeError) {
      return NextResponse.json({ error: storeError.message }, { status: 500 })
    }

    // Create default area with QR token
    const qrToken = generateQrToken()
    const { error: areaError } = await supabase
      .from('areas')
      .insert({
        store_id: store.id,
        tenant_id: tenantId,
        name: 'バックヤード入口',
        qr_token: qrToken,
      })

    if (areaError) {
      return NextResponse.json({ error: areaError.message }, { status: 500 })
    }

    return NextResponse.json({ storeId: store.id, qrToken })
  } catch (err) {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = req.nextUrl
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 })

    const body = await req.json()
    const { name, address, is_active } = body
    if (name !== undefined && !name?.trim()) {
      return NextResponse.json({ error: '店舗名は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name.trim()
    if (address !== undefined) updates.address = address?.trim() || null
    if (is_active !== undefined) updates.is_active = is_active

    // settings JSONB の部分更新（既存キーを保持しつつマージ）
    const { settings } = body
    if (settings !== undefined) {
      // 既存の settings を取得してマージ
      const { data: current } = await supabase.from('stores').select('settings').eq('id', id).single()
      updates.settings = { ...(current?.settings ?? {}), ...settings }
    }

    const { error } = await supabase.from('stores').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
