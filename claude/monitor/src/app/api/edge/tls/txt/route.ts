/**
 * PUT / DELETE /api/edge/tls/txt — 拠点の証明書の検証用 TXT（GVMS_CLOUD_SPEC §10.4・D-2-20）
 *
 * 拠点は Let's Encrypt の DNS-01 で証明書を取るとき、`_acme-challenge.<自分の名前>` の TXT を
 * ここに頼む。DNS 事業者の鍵は拠点に渡さず、**その拠点に決めた名前の TXT だけ**を受ける
 * （他の名前・他の拠点の名前は 403）。値は ACME の検証値（base64url・128 字まで）。
 *
 *   PUT    { name, value } → 204（足す。同じ名前は 5 件まで・古いものから消す）
 *   DELETE { name, value } → 204（値の一致するものを消す。無くても 204）
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { createSupabaseService } from '@/lib/supabase/server'
import { addTXT, cloudflareDnsConfigured, deleteTXT } from '@/lib/dns/cloudflare'
import { ACME_VALUE_RE, txtNameAllowed } from '@/lib/edge/site-tls'

export const dynamic = 'force-dynamic'

const Body = z.object({
  name: z.string().max(260),
  value: z.string().regex(ACME_VALUE_RE),
})

async function handle(req: NextRequest, op: 'add' | 'delete') {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  if (!cloudflareDnsConfigured()) return NextResponse.json({ error: 'dns_unavailable' }, { status: 503 })

  const svc = createSupabaseService()
  const { data } = await svc.from('edge_devices').select('site_hostname').eq('id', edge.id).maybeSingle()
  const hostname = (data?.site_hostname as string | null) ?? null
  if (!txtNameAllowed(parsed.data.name, hostname)) {
    return NextResponse.json({ error: 'name_not_allowed' }, { status: 403 })
  }
  const name = parsed.data.name.trim().toLowerCase()
  try {
    if (op === 'add') await addTXT(name, parsed.data.value)
    else await deleteTXT(name, parsed.data.value)
  } catch (e) {
    console.warn('site tls txt failed', { edge: edge.id, op, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'dns_error' }, { status: 502 })
  }
  return new NextResponse(null, { status: 204 })
}

export async function PUT(req: NextRequest) { return handle(req, 'add') }
export async function DELETE(req: NextRequest) { return handle(req, 'delete') }
