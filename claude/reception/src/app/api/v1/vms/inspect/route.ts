/**
 * POST /api/v1/vms/inspect
 *
 * 手荷物検査の開始を記録する。
 * VMS (OSS-VMS) には inspection エンドポイントが存在しないため、
 * DB の baggage_declarations に inspection_started_at を書き込むのみ。
 * ライブ映像は GET /api/v1/admin/stores/:id/live-cameras で取得する。
 *
 * Request body:
 *   { storeId: string, cameraId?: string, visitId?: string, declarationId?: string }
 *
 * Response:
 *   { ok: true, started_at: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

// VULN-005 FIX: VMS inspect endpoint now requires admin authentication
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { declarationId, visitId } = await req.json()

    const supabase = createAdminClient()
    const startedAt = new Date().toISOString()

    if (declarationId) {
      await supabase
        .from('baggage_declarations')
        .update({ inspection_started_at: startedAt })
        .eq('id', declarationId)
    } else if (visitId) {
      // 最新の未終了申告を探して更新
      const { data: decl } = await supabase
        .from('baggage_declarations')
        .select('id')
        .eq('visit_id', visitId)
        .is('inspection_started_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (decl) {
        await supabase
          .from('baggage_declarations')
          .update({ inspection_started_at: startedAt })
          .eq('id', decl.id)
      }
    }

    return NextResponse.json({ ok: true, started_at: startedAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'エラー'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
