/**
 * PUT / DELETE /api/admin/edges/[id]/site-host — 拠点の https の名前（GVMS_CLOUD_SPEC §10.2・D-2-20）
 *
 *   PUT    { label, lan_ip } → { hostname }   ラベルと LAN の IP を決め、A レコードを置いて版を上げる
 *   DELETE                   → 204            名前を外し、A レコードを消して版を上げる
 *
 * super_admin だけ（拠点の詳細画面と同じ）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'
import { cloudflareDnsConfigured } from '@/lib/dns/cloudflare'
import { clearSiteHost, isPrivateIPv4, normalizeLabel, setSiteHost } from '@/lib/edge/site-tls'

export const dynamic = 'force-dynamic'

const Body = z.object({ label: z.string().max(64), lan_ip: z.string().max(15) })

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const label = normalizeLabel(parsed.data.label)
  if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })
  if (!isPrivateIPv4(parsed.data.lan_ip)) return NextResponse.json({ error: 'invalid_ip' }, { status: 400 })
  if (!cloudflareDnsConfigured()) return NextResponse.json({ error: 'dns_unavailable' }, { status: 503 })

  const svc = createSupabaseService()
  const { data: edge } = await svc.from('edge_devices').select('id, agent_version').eq('id', id).maybeSingle()
  if (!edge) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const r = await setSiteHost(svc, id, label, parsed.data.lan_ip.trim())
    await recordAudit(guard.supa, {
      actorUserId: guard.user.id, action: 'edge.site_host.set', targetType: 'edge', targetId: id,
      storeId: await storeIdForEdge(guard.supa, id), changes: { hostname: r.hostname, lan_ip: parsed.data.lan_ip.trim() },
    })
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'hostname_taken') return NextResponse.json({ error: 'hostname_taken' }, { status: 409 })
    console.warn('site host set failed', { edge: id, error: msg })
    return NextResponse.json({ error: msg.startsWith('cloudflare:') ? 'dns_error' : msg }, { status: 502 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { id } = await ctx.params
  const svc = createSupabaseService()
  try {
    await clearSiteHost(svc, id)
    await recordAudit(guard.supa, {
      actorUserId: guard.user.id, action: 'edge.site_host.clear', targetType: 'edge', targetId: id,
      storeId: await storeIdForEdge(guard.supa, id),
    })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.warn('site host clear failed', { edge: id, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'dns_error' }, { status: 502 })
  }
}
