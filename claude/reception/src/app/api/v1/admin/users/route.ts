import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

// VULN-001 FIX: Use invite-by-email flow instead of hardcoded temp password.
// Supabase sends an invite link. The user sets their own password on first login.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { email, name, role } = body

    if (!email?.trim() || !name?.trim()) {
      return NextResponse.json({ error: 'メールと名前は必須です' }, { status: 400 })
    }

    // Only tenant_admin can create other admins
    if (ctx.role !== 'tenant_admin') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }

    const supabase = createAdminClient()

    // Invite user via email — no hardcoded password, Supabase sends a magic link
    const redirectTo = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/admin/login`
      : undefined

    const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(
      email.trim(),
      { redirectTo }
    )

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    // Set app_metadata so the tenant is bound at the auth layer too
    await supabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { tenant_id: ctx.tenant_id },
    })

    // Create admin_users record
    const { error: dbError } = await supabase
      .from('admin_users')
      .insert({
        tenant_id: ctx.tenant_id,
        email: email.trim(),
        name: name.trim(),
        role: role || 'viewer',
        auth_user_id: authData.user.id,
      })

    if (dbError) {
      // Clean up the auth user if DB insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getAdminContext()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

    const body = await req.json()
    const { name, role } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: '名前は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // VULN-007 FIX: Scope update to caller's tenant only — prevents cross-tenant modification
    const { error } = await supabase
      .from('admin_users')
      .update({ name: name.trim(), role: role || 'viewer' })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
