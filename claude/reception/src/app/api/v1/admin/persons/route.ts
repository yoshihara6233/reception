/**
 * /api/v1/admin/persons
 *
 * 来店者管理 CRUD エンドポイント
 *
 * GET    ?type=employee|external|primary|all&q=<search>  — 一覧取得
 * POST                                                    — 新規登録 (employee / external)
 * PATCH  ?id=<visitorId>                                  — 編集・昇格
 * DELETE ?id=<visitorId>                                  — 削除 (face_id も Rekognition から削除)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

export const dynamic = 'force-dynamic'

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'all'
  const q    = searchParams.get('q') || ''

  const supabase = createAdminClient()

  // ── 一次受付者: 直近30日以内に来訪した visitor タイプ ──────────────────────
  if (type === 'primary') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // 直近30日以内に来訪した visitor_id を取得
    const { data: recentVisits } = await supabase
      .from('visits')
      .select('visitor_id, check_in_at')
      .eq('tenant_id', TENANT_ID)
      .gte('check_in_at', thirtyDaysAgo)
      .order('check_in_at', { ascending: false })

    const visitorIdToLastVisit: Record<string, string> = {}
    for (const v of (recentVisits ?? [])) {
      if (!visitorIdToLastVisit[v.visitor_id]) {
        visitorIdToLastVisit[v.visitor_id] = v.check_in_at
      }
    }

    const visitorIds = Object.keys(visitorIdToLastVisit)
    if (visitorIds.length === 0) {
      return NextResponse.json({ persons: [] })
    }

    let query = supabase
      .from('visitors')
      .select('id, name, company, department, phone, email, person_type, employee_code, notes, face_id, face_registered_at, is_registered, created_at')
      .eq('tenant_id', TENANT_ID)
      .eq('person_type', 'visitor')
      .in('id', visitorIds)

    if (q) {
      query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 最終来訪日を付与
    const persons = (data ?? []).map((p: any) => ({
      ...p,
      facePhotoUrl: null,
      lastVisitAt: visitorIdToLastVisit[p.id] ?? null,
    }))

    // 最終来訪日の新しい順
    persons.sort((a, b) =>
      new Date(b.lastVisitAt ?? 0).getTime() - new Date(a.lastVisitAt ?? 0).getTime()
    )

    return NextResponse.json({ persons })
  }

  // ── 従業員 / 外部登録者 ──────────────────────────────────────────────────────
  let query = supabase
    .from('visitors')
    .select('id, name, company, department, phone, email, person_type, employee_code, notes, face_id, face_registered_at, is_registered, created_at')
    .eq('tenant_id', TENANT_ID)
    .neq('person_type', 'visitor')
    .order('created_at', { ascending: false })

  if (type !== 'all') {
    query = query.eq('person_type', type)
  }

  if (q) {
    query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%,employee_code.ilike.%${q}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const persons = (data ?? []).map((p: any) => ({ ...p, facePhotoUrl: null }))

  return NextResponse.json({ persons })
}

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, company, department, phone, email, person_type, employee_code, notes } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: '名前は必須です' }, { status: 400 })
    }

    if (!person_type || !['employee', 'external'].includes(person_type)) {
      return NextResponse.json({ error: 'person_type は employee または external を指定してください' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('visitors')
      .insert({
        tenant_id:     TENANT_ID,
        name:          name.trim(),
        company:       company?.trim() || '',
        department:    department?.trim() || null,
        phone:         phone?.trim() || null,
        email:         email?.trim() || null,
        person_type,
        employee_code: employee_code?.trim() || null,
        notes:         notes?.trim() || null,
        is_registered: true,
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data.id })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

// ── PATCH ──────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

    const body = await req.json()
    const { name, company, department, phone, email, person_type, employee_code, notes, promote } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: '名前は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // 顔登録リセット要求
    if (body.reset_face === true) {
      const { data: visitor } = await supabase
        .from('visitors')
        .select('face_id, tenant_id')
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
        .single()

      if (visitor?.face_id) {
        if (process.env.AWS_ACCESS_KEY_ID) {
          try {
            const { deleteFace } = await import('@/lib/aws/rekognition')
            await deleteFace(visitor.tenant_id, visitor.face_id)
          } catch (e) {
            console.warn('[persons PATCH] Rekognition deleteFace failed (non-fatal):', e)
          }
        }
      }

      const { error } = await supabase
        .from('visitors')
        .update({
          name:          name.trim(),
          company:       company?.trim() || '',
          department:    department?.trim() || null,
          phone:         phone?.trim() || null,
          email:         email?.trim() || null,
          person_type,
          employee_code: employee_code?.trim() || null,
          notes:         notes?.trim() || null,
          face_id:           null,
          face_registered_at: null,
          face_auth_consent:  false,
        })
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // 昇格 (一次受付者 → 従業員 / 外部登録者)
    const updateFields: Record<string, unknown> = {
      name:          name.trim(),
      company:       company?.trim() || '',
      department:    department?.trim() || null,
      phone:         phone?.trim() || null,
      email:         email?.trim() || null,
      person_type,
      employee_code: employee_code?.trim() || null,
      notes:         notes?.trim() || null,
    }

    if (promote) {
      updateFields.is_registered = true
    }

    const { error } = await supabase
      .from('visitors')
      .update(updateFields)
      .eq('id', id)
      .eq('tenant_id', TENANT_ID)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

    const supabase = createAdminClient()

    const { data: visitor } = await supabase
      .from('visitors')
      .select('face_id, tenant_id')
      .eq('id', id)
      .eq('tenant_id', TENANT_ID)
      .single()

    if (visitor?.face_id && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const { deleteFace } = await import('@/lib/aws/rekognition')
        await deleteFace(visitor.tenant_id, visitor.face_id)
      } catch (e) {
        console.warn('[persons DELETE] Rekognition deleteFace failed (non-fatal):', e)
      }
    }

    const { error } = await supabase
      .from('visitors')
      .delete()
      .eq('id', id)
      .eq('tenant_id', TENANT_ID)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
