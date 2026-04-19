import { createClient } from '@supabase/supabase-js'

export interface QrValidationResult {
  valid: boolean
  areaId?: string
  storeId?: string
  tenantId?: string
  storeName?: string
  areaName?: string
  error?: string
}

export async function validateQrToken(token: string): Promise<QrValidationResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Look up the area by qr_token directly
  const { data: area, error } = await supabase
    .from('areas')
    .select('id, store_id, tenant_id, name, stores(name)')
    .eq('qr_token', token)
    .eq('is_active', true)
    .single()

  if (error || !area) {
    return { valid: false, error: 'このQRコードは無効です。スタッフにお声がけください。' }
  }

  const storeData = area.stores as unknown as { name: string } | null

  return {
    valid: true,
    areaId: area.id,
    storeId: area.store_id,
    tenantId: area.tenant_id,
    storeName: storeData?.name,
    areaName: area.name,
  }
}
