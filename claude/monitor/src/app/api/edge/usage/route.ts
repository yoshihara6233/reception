/**
 * POST /api/edge/usage — 現場の G・VMS からの使われ方の 1 日の集計（GVMS_CLOUD_SPEC §12.4・D-2-22）
 *
 * 窓口ノードが毎日 3:00〜4:00 に前日分を送る。同じ (拠点, 日) は上書き。
 *
 * 応答:
 *   204                                 受け付けた
 *   400 { error: 'invalid_body' }       日 (day) か版 (schema) が読めない・日が古すぎる/未来
 *   401                                 トークンが違う
 *   409 { error: 'usage_disabled' }     受付を閉じている（約款の施行前 = GVMS_USAGE_INTAKE が on でない・
 *                                       またはテナントが止めている）。拠点はその日の分を捨てる
 *   413 { error: 'payload_too_large' }  64 KB を超えた
 *
 * **知らない項目は捨てて保存し、拒否しない**（lib/edge-usage/report.ts）。名前・IP・映像・
 * 個々の操作の記録は拠点が送らない決まりで、形の合わない値はここでも落とす。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { readJsonBody } from '@/lib/feedback/intake'
import { USAGE_MAX_BYTES, cleanPayload, parseHeader, usageIntakeOpen } from '@/lib/edge-usage/report'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // 約款（G-6）の施行前は、テナントの設定に関わらず受けない（中身も読まない）
  if (!usageIntakeOpen()) return NextResponse.json({ error: 'usage_disabled' }, { status: 409 })

  const raw = await readJsonBody(req, USAGE_MAX_BYTES)
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status })
  const head = parseHeader(raw.value)
  if (!head) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const svc = createSupabaseService()
  const { data: store, error: storeErr } = await svc
    .from('stores')
    .select('tenant_id')
    .eq('id', edge.store_id)
    .maybeSingle()
  if (storeErr || !store) return NextResponse.json({ error: 'store_not_found' }, { status: 500 })
  const tenantId = (store as { tenant_id: string }).tenant_id

  const { data: tenant, error: tenantErr } = await svc
    .from('tenants')
    .select('usage_enabled')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr || !tenant) return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 500 })
  if ((tenant as { usage_enabled: boolean | null }).usage_enabled === false) {
    return NextResponse.json({ error: 'usage_disabled' }, { status: 409 })
  }

  const { error: upErr } = await svc
    .from('edge_usage_reports')
    .upsert({
      tenant_id: tenantId,
      store_id: edge.store_id,
      edge_id: edge.id,
      day: head.day,
      schema: head.schema,
      agent_version: head.agentVersion,
      payload: cleanPayload(raw.value),
      received_at: new Date().toISOString(),
    }, { onConflict: 'edge_id,day' })
  if (upErr) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
