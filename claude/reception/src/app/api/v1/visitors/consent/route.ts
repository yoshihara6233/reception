import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

// GET /api/v1/visitors/consent?token={qr_token}
// Returns the active consent template for this area's tenant
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }

    const supabase = createAdminClient()
    const { data: template } = await supabase
      .from('consent_templates')
      .select('id, version, body_ja, body_en, body_zh, body_ko')
      .eq('tenant_id', qr.tenantId!)
      .eq('is_active', true)
      .maybeSingle()

    // No active template = consent gate disabled for this tenant
    return NextResponse.json({ template: template ?? null })
  } catch (err) {
    console.error('GET visitor consent error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST /api/v1/visitors/consent
// Records visitor consent. Returns consent_record id.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, consent_template_id } = body

    if (!token || !consent_template_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }

    const supabase = createAdminClient()

    // Verify the template belongs to this tenant and is active
    const { data: template } = await supabase
      .from('consent_templates')
      .select('id')
      .eq('id', consent_template_id)
      .eq('tenant_id', qr.tenantId!)
      .eq('is_active', true)
      .maybeSingle()

    if (!template) {
      return NextResponse.json({ error: '無効な同意テンプレートです' }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || null

    const { data: record, error } = await supabase
      .from('consent_records')
      .insert({
        tenant_id: qr.tenantId!,
        consent_template_id,
        ip_address: ip,
        user_agent: req.headers.get('user-agent') || null,
        // visit_id is null here — linked after check-in completes
      })
      .select('id')
      .single()

    if (error || !record) {
      console.error('consent_records insert error:', error)
      return NextResponse.json({ error: '同意の記録に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ consent_record_id: record.id })
  } catch (err) {
    console.error('POST visitor consent error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
