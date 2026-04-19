import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const TENANT_ID = '00000000-0000-0000-0000-000000000001' // TODO: from auth

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****'
  return '****...' + secret.slice(-4)
}

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('webhook_endpoints')
    .select('id, url, events, enabled, retry_count, last_error, created_at, secret')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const endpoints = (data ?? []).map(ep => ({
    ...ep,
    secret: maskSecret(ep.secret),
  }))

  return NextResponse.json({ endpoints })
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { url, events } = body

  if (!url || !events?.length) {
    return NextResponse.json({ error: 'url and events are required' }, { status: 400 })
  }

  const secret = crypto.randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      tenant_id: TENANT_ID,
      url,
      secret,
      events,
      enabled: true,
    })
    .select('id, url, events, enabled, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return secret only on creation
  return NextResponse.json({ endpoint: data, secret })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
