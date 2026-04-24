import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, name, role } = body
    const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

    if (!email?.trim() || !name?.trim()) {
      return NextResponse.json({ error: 'メールと名前は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: 'temp-password-123', // User should change on first login
      email_confirm: true,
      app_metadata: { tenant_id: tenantId },
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    // Create admin_users record
    const { error: dbError } = await supabase
      .from('admin_users')
      .insert({
        tenant_id: tenantId,
        email: email.trim(),
        name: name.trim(),
        role: role || 'viewer',
        auth_user_id: authData.user.id,
      })

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

    const body = await req.json()
    const { name, role } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: '名前は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('admin_users')
      .update({ name: name.trim(), role: role || 'viewer' })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
