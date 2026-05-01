/**
 * /api/v1/admin/persons
 *
 * 来店者管理 CRUD エンドポイント
 *
 * GET    ?type=employee|external|all&q=<search>  — 一覧取得
 * POST                                            — 新規登録 (employee / external)
 * PATCH  ?id=<visitorId>                          — 編集
 * DELETE ?id=<visitorId>                          — 削除 (face_id も Rekognition から削除)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

export const dynamic = 'force-dynamic'

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'all'   // 'employee' | 'external' | 'all'
  const q    = searchParams.get('q') || ''

  const supabase = createAdminClient()

  let query = supabase
    .from('visitors')
    .select('id, name, company, department, phone, email, person_type, employee_code, notes, face_id, face_registered_at, face_photo_path, is_registered, created_at')
    .eq('tenant_id', TENANT_ID)
    .neq('person_type', 'visitor')   // 一般来訪者は除く
    .order('created_at', { ascending: false })

  if (type !== 'all') {
    query = query.eq('person_type', type)
  }

  if (q) {
    query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%,employee_code.ilike.%${q}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 顔写真の signed URL を生成
  const persons = await Promise.all(
    (data ?? []).map(async (p: any) => {
      let facePhotoUrl: string | null = null
      if (p.face_photo_path) {
        const { data: signed } = await supabase.storage
          .from('visit-photos')
          .createSignedUrl(p.face_photo_path, 3600)
        facePhotoUrl = signed?.signedUrl ?? null
      }
      return { ...p, facePhotoUrl }
    })
  )

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
    const { name, company, department, phone, email, person_type, employee_code, notes } = body

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
        // Rekognition から削除 (AWS 設定がある場合のみ)
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
      })
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

    // 顔 ID を先に取得して Rekognition からも削除
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
