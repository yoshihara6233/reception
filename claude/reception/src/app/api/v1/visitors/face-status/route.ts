/**
 * GET /api/v1/visitors/face-status?visitId=<id>
 *
 * 訪問者の顔登録状態を確認する。
 * チェックイン完了画面で「顔登録バナーを出すかどうか」に使用。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const visitId = searchParams.get('visitId')

  if (!visitId) {
    return NextResponse.json({ error: 'visitId is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: visit, error } = await supabase
    .from('visits')
    .select('visitor_id, visitors!inner(face_id, face_registered_at)')
    .eq('id', visitId)
    .single()

  if (error || !visit) {
    return NextResponse.json({ face_id: null })
  }

  const visitor = Array.isArray(visit.visitors) ? visit.visitors[0] : visit.visitors as { face_id: string | null; face_registered_at: string | null } | null

  return NextResponse.json({
    face_id:            visitor?.face_id ?? null,
    face_registered_at: visitor?.face_registered_at ?? null,
  })
}
