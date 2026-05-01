/**
 * GET  /api/v1/visitors/me?token={qrToken}&visitorId={visitorId}
 *   → 来訪者情報 + 前回来訪日時 (リピーター検知用)
 *
 * PUT  /api/v1/visitors/me
 *   body: { token, visitorId, company?, department?, phone?, email? }
 *   → 来訪者情報の部分更新 (会社名・部署・電話・メールのみ)
 *
 * セキュリティ:
 *   - QR token → tenant_id を解決してから visitors.tenant_id と照合
 *   - 別テナントの visitorId は 403
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token      = searchParams.get('token')
  const visitorId  = searchParams.get('visitorId')

  if (!token || !visitorId) {
    return NextResponse.json({ error: 'token and visitorId are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // QR token → tenant_id
  const { data: area, error: areaErr } = await supabase
    .from('areas')
    .select('tenant_id')
    .eq('qr_token', token)
    .eq('is_active', true)
    .single()

  if (areaErr || !area) {
    return NextResponse.json({ error: '無効なQRコードです' }, { status: 404 })
  }

  const tenantId = area.tenant_id

  // visitor を取得 (テナント照合)
  const { data: visitor, error: visitorErr } = await supabase
    .from('visitors')
    .select('id, name, company, department, phone, email')
    .eq('id', visitorId)
    .eq('tenant_id', tenantId)
    .single()

  if (visitorErr || !visitor) {
    return NextResponse.json({ error: '来訪者が見つかりません' }, { status: 404 })
  }

  // 前回来訪を取得 (最新1件)
  const { data: lastVisit } = await supabase
    .from('visits')
    .select('check_in_at, purpose, contact_person')
    .eq('visitor_id', visitorId)
    .eq('tenant_id', tenantId)
    .order('check_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    visitor: {
      id:         visitor.id,
      name:       visitor.name,
      company:    visitor.company,
      department: visitor.department ?? '',
      phone:      visitor.phone ?? '',
      email:      visitor.email ?? '',
    },
    lastVisit: lastVisit
      ? {
          date:          lastVisit.check_in_at,
          purpose:       lastVisit.purpose,
          contactPerson: lastVisit.contact_person ?? '',
        }
      : null,
  })
}

// ── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, visitorId, company, department, phone, email } = body as {
      token:       string
      visitorId:   string
      company?:    string
      department?: string
      phone?:      string
      email?:      string
    }

    if (!token || !visitorId) {
      return NextResponse.json({ error: 'token and visitorId are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // QR token → tenant_id
    const { data: area, error: areaErr } = await supabase
      .from('areas')
      .select('tenant_id')
      .eq('qr_token', token)
      .eq('is_active', true)
      .single()

    if (areaErr || !area) {
      return NextResponse.json({ error: '無効なQRコードです' }, { status: 404 })
    }

    const tenantId = area.tenant_id

    // 更新可能フィールドのみ (name は変更不可)
    const updates: Record<string, string> = {}
    if (company    !== undefined) updates.company    = company
    if (department !== undefined) updates.department = department
    if (phone      !== undefined) updates.phone      = phone
    if (email      !== undefined) updates.email      = email

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '更新するフィールドがありません' }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from('visitors')
      .update(updates)
      .eq('id', visitorId)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      console.error('[visitors/me PUT] update error:', updateErr.message)
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'サーバーエラー'
    console.error('[visitors/me PUT] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
