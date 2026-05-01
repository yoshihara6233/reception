/**
 * PATCH /api/v1/vms/inspect/[id]
 *
 * 検査終了: baggage_declarations に inspection_ended_at を保存する。
 * VMS (OSS-VMS) には inspection エンドポイントが存在しないため DB のみ更新。
 *
 * Request body:
 *   { declarationId?: string, endedAt?: string }
 *
 * GET /api/v1/vms/inspect/[id]
 *
 * 申告の検査情報を返す (DB から)。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: declarationId } = await params
  const body = await req.json().catch(() => ({}))
  const endedAt = (body.endedAt as string | undefined) ?? new Date().toISOString()

  const admin = createAdminClient()

  const { error } = await admin
    .from('baggage_declarations')
    .update({ inspection_ended_at: endedAt })
    .eq('id', declarationId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, ended_at: endedAt })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: declarationId } = await params
  const admin = createAdminClient()

  const { data: decl } = await admin
    .from('baggage_declarations')
    .select('id, visit_id, inspection_mode, inspection_started_at, inspection_ended_at, vms_hls_url, status')
    .eq('id', declarationId)
    .single()

  if (!decl) {
    return NextResponse.json({ error: '申告が見つかりません' }, { status: 404 })
  }

  return NextResponse.json(decl)
}
