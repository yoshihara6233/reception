import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/v1/admin/settings/consent
// Returns the active consent template for the current tenant
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data: adminUser } = await adminClient
      .from('admin_users')
      .select('tenant_id, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: template } = await adminClient
      .from('consent_templates')
      .select('*')
      .eq('tenant_id', adminUser.tenant_id)
      .eq('is_active', true)
      .maybeSingle()

    return NextResponse.json({ template: template ?? null })
  } catch (err) {
    console.error('GET consent template error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PUT /api/v1/admin/settings/consent
// Atomically activates a new consent template (deactivates old one)
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data: adminUser } = await adminClient
      .from('admin_users')
      .select('tenant_id, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!['tenant_admin', 'store_manager'].includes(adminUser.role)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }

    const body = await req.json()
    const { version, body_ja, body_en, body_zh, body_ko } = body

    if (!body_ja?.trim()) {
      return NextResponse.json({ error: '日本語同意文は必須です' }, { status: 400 })
    }

    // Atomic swap via DB function
    const { data: newId, error } = await adminClient.rpc('activate_consent_template', {
      p_tenant_id: adminUser.tenant_id,
      p_version: version?.trim() || '1.0',
      p_body_ja: body_ja.trim(),
      p_body_en: body_en?.trim() || null,
      p_body_zh: body_zh?.trim() || null,
      p_body_ko: body_ko?.trim() || null,
    })

    if (error) {
      console.error('activate_consent_template error:', error)
      return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ id: newId })
  } catch (err) {
    console.error('PUT consent template error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/v1/admin/settings/consent
// Clears (deactivates) the active consent template — disables consent gate
export async function DELETE() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data: adminUser } = await adminClient
      .from('admin_users')
      .select('tenant_id, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!adminUser || adminUser.role !== 'tenant_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await adminClient
      .from('consent_templates')
      .update({ is_active: false })
      .eq('tenant_id', adminUser.tenant_id)
      .eq('is_active', true)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE consent template error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
