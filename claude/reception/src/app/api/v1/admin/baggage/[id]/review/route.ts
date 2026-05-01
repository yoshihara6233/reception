/**
 * PATCH /api/v1/admin/baggage/[id]/review
 * 手荷物申告の審査結果を更新 (approved / flagged / cleared)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit, extractRequestMeta } from '@/lib/audit-log'

interface Params {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params

  // Auth check
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get admin_user id for reviewed_by
  const admin = createAdminClient()
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { status, staff_notes } = body as { status: string; staff_notes?: string }

  const VALID = ['approved', 'flagged', 'cleared', 'rejected']
  if (!VALID.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { error } = await admin
    .from('baggage_declarations')
    .update({
      status,
      staff_notes: staff_notes ?? null,
      reviewed_by: adminUser.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', adminUser.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 監査ログ
  const { ip, userAgent } = extractRequestMeta(req)
  await logAudit({
    tenant_id:     adminUser.tenant_id,
    admin_user_id: adminUser.id,
    action:        'baggage_review',
    resource_type: 'baggage',
    resource_id:   id,
    details:       { status, staff_notes: staff_notes ?? null },
    ip_address:    ip,
    user_agent:    userAgent,
  })

  return NextResponse.json({ ok: true })
}
