import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

// GET /api/v1/admin/settings/consent
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: template } = await supabase
    .from('consent_templates')
    .select('*')
    .eq('tenant_id', ctx.tenant_id)
    .eq('is_active', true)
    .maybeSingle()

  return NextResponse.json({ template: template ?? null })
}

// PUT /api/v1/admin/settings/consent
// Atomically activates a new consent template (deactivates old one)
export async function PUT(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { version, body_ja, body_en, body_zh, body_ko } = body

  if (!body_ja?.trim()) {
    return NextResponse.json({ error: '日本語同意文は必須です' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Atomic swap via DB function
  const { data: newId, error } = await supabase.rpc('activate_consent_template', {
    p_tenant_id: ctx.tenant_id,
    p_version: version?.trim() || '1.0',
    p_body_ja: body_ja.trim(),
    p_body_en: body_en?.trim() || null,
    p_body_zh: body_zh?.trim() || null,
    p_body_ko: body_ko?.trim() || null,
  })

  if (error) {
    console.error('activate_consent_template error:', error)
    return NextResponse.json({ error: '保存に失敗しました: ' + error.message }, { status: 500 })
  }

  return NextResponse.json({ id: newId })
}

// DELETE /api/v1/admin/settings/consent
// Clears (deactivates) the active consent template — disables consent gate
export async function DELETE() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createAdminClient()
  await supabase
    .from('consent_templates')
    .update({ is_active: false })
    .eq('tenant_id', ctx.tenant_id)
    .eq('is_active', true)

  return NextResponse.json({ ok: true })
}
