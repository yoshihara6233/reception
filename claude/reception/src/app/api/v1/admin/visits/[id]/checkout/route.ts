/**
 * POST /api/v1/admin/visits/[id]/checkout
 *
 * Admin-side forced checkout — sets check_out_at = now, status = checked_out.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('visits')
    .update({
      check_out_at: new Date().toISOString(),
      status: 'checked_out',
    })
    .eq('id', id)
    .eq('status', 'checked_in')   // only allow if currently checked in
    .select('id, status, check_out_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: '退室処理に失敗しました' }, { status: 400 })
  }

  return NextResponse.json(data)
}
