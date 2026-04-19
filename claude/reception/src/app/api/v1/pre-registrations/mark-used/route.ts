import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/v1/pre-registrations/mark-used
// Called after a successful check-in to link the pre-registration to the visit
export async function POST(req: NextRequest) {
  try {
    const { pre_registration_id, visit_id } = await req.json()

    if (!pre_registration_id || !visit_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('pre_registrations')
      .update({
        used_at: new Date().toISOString(),
        visit_id,
      })
      .eq('id', pre_registration_id)
      .is('used_at', null)   // idempotent: only mark once

    if (error) {
      console.error('[pre-reg/mark-used] error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pre-reg/mark-used] unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
