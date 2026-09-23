/**
 * GET /api/edge/license — nvmsd へのライセンス配送（LICENSE_SPEC §4.1）
 *
 * OTA の agent-update と同型。クラウドは署名済みライセンス（G・VMS 形式・不透明）を
 * 保管して配るだけ。正当性は nvmsd が埋め込み公開鍵で署名検証して担保する。
 *
 * 204 = 未発行 or 失効。200 = { license_version, recorderId?, license }。
 * nvmsd は license_version が変わったときだけ取り込む。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: lic } = await svc
    .from('licenses')
    .select('license_version, license_blob, status')
    .eq('edge_id', edge.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!lic) return new NextResponse(null, { status: 204 })

  return NextResponse.json(
    { license_version: lic.license_version, license: lic.license_blob },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
