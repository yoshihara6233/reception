import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data })
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { event_type, channel, config, store_id, enabled } = body

  if (!event_type || !channel || !config) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('notification_rules')
    .insert({
      tenant_id: TENANT_ID,
      store_id: store_id || null,
      event_type,
      channel,
      config,
      enabled: enabled !== false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('notification_rules')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
