import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/v1/visitors/consent/link
// Links a previously created consent_record to the visit created at check-in
export async function POST(req: NextRequest) {
  try {
    const { consent_record_id, visit_id } = await req.json()
    if (!consent_record_id || !visit_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify the visit exists
    const { data: visit } = await supabase
      .from('visits')
      .select('id, tenant_id')
      .eq('id', visit_id)
      .maybeSingle()

    if (!visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
    }

    // Update the consent record — only if it has no visit_id yet (idempotent)
    const { error } = await supabase
      .from('consent_records')
      .update({ visit_id })
      .eq('id', consent_record_id)
      .is('visit_id', null)

    if (error) {
      console.error('consent link error:', error)
      return NextResponse.json({ error: 'Link failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('consent link error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
