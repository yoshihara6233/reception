/**
 * 従業員マスタ（T6・店舗毎）
 *
 * GET  /api/v1/baggage/employees?storeId=  — 一覧（店舗スコープ）
 * POST /api/v1/baggage/employees            — 登録（社員コード・氏名・任意で顔）
 *   顔登録（Rekognition 常設コレクション）は顔画像アップロード導線とあわせて別段。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { isFullAdmin } from '@/lib/acl'

async function guard(storeId: string | null) {
  const ctx = await getAdminContext()
  if (!ctx) return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }
  if (storeId && !isFullAdmin(ctx.role) && !ctx.store_ids.includes(storeId)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) }
  }
  return { ctx, supabase: createAdminClient() }
}

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId')
  const g = await guard(storeId)
  if ('error' in g) return g.error
  const { ctx, supabase } = g

  let q = supabase
    .from('store_employees')
    .select('id, store_id, employee_code, name, active, rekognition_face_id, created_at')
    .eq('tenant_id', ctx.tenant_id)
    .order('employee_code', { ascending: true })
  if (storeId) q = q.eq('store_id', storeId)
  else if (!isFullAdmin(ctx.role)) q = q.in('store_id', ctx.store_ids.length ? ctx.store_ids : ['00000000-0000-0000-0000-000000000000'])

  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'failed to list' }, { status: 500 })
  return NextResponse.json({ employees: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    | { storeId?: string; employeeCode?: string; name?: string; facePhotoPath?: string | null } | null
  if (!body?.storeId || !body.employeeCode || !body.name) {
    return NextResponse.json({ error: 'storeId, employeeCode, name are required' }, { status: 400 })
  }
  const g = await guard(body.storeId)
  if ('error' in g) return g.error
  const { ctx, supabase } = g

  // 店舗がテナントに属することを確認
  const { data: store } = await supabase.from('stores').select('tenant_id').eq('id', body.storeId).maybeSingle()
  if (!store || store.tenant_id !== ctx.tenant_id) {
    return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('store_employees')
    .insert({
      tenant_id: ctx.tenant_id,
      store_id: body.storeId,
      employee_code: body.employeeCode,
      name: body.name,
      face_photo_path: body.facePhotoPath ?? null,
      active: true,
    })
    .select('id, employee_code, name, active')
    .single()

  if (error) {
    // 一意制約（store_id, employee_code）違反など
    const msg = /duplicate|unique/i.test(error.message) ? '同じ社員コードが既に登録されています' : '登録に失敗しました'
    return NextResponse.json({ error: msg }, { status: 409 })
  }

  await supabase.from('audit_logs').insert({
    tenant_id: ctx.tenant_id, admin_user_id: ctx.id,
    action: 'baggage.employee.create', resource_type: 'store_employee', resource_id: data.id,
    details: { store_id: body.storeId, employee_code: body.employeeCode },
  })

  return NextResponse.json({ employee: data }, { status: 201 })
}
