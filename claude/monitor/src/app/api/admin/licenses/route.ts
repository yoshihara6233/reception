/**
 * ライセンス台帳（LICENSE_SPEC §3）
 *
 * GET  — 一覧（テナント権限・RLS で自テナントのみ）。
 * POST — 登録/差し替え: G・VMS 署名済みライセンス（不透明 blob）＋メタを台帳へ。
 *        同じエッジに有効ライセンスがあれば blob/メタを更新して版を +1（差し替え）、
 *        無ければ新規。クラウドは blob を解釈しない（OTA の sig と同じ透過）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

const Body = z.object({
  edge_id:     z.string().uuid(),
  // G・VMS 署名済みライセンス（既存形式・不透明）。中身は解釈しないが、制御文字・
  // 空白の混入だけ拒む（OTA の sig と同型・印字可能 ASCII）。
  license_blob: z.string().transform((s) => s.trim()).pipe(
    z.string().min(8).max(16384).regex(/^[\x21-\x7E]+$/),
  ),
  org_name:    z.string().max(200).nullable().optional(),
  max_cameras: z.number().int().min(0).max(100000).nullable().optional(),
  expires_at:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  bound_mac:   z.string().max(64).nullable().optional(),
  notes:       z.string().max(1000).nullable().optional(),
})

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  // RLS（licenses_select）が自テナントに絞る。super_admin は横断。
  const { data, error } = await guard.supa
    .from('licenses')
    .select('id, edge_id, store_id, org_name, max_cameras, expires_at, bound_mac, notes, license_version, status, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ licenses: data ?? [] })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { edge_id, license_blob, org_name, max_cameras, expires_at, bound_mac, notes } = parsed.data

  // 認可: 呼び出し管理者からそのエッジ（＝店舗）が見えるか（RLS セッション）→ tenant を得る。
  const { data: edge } = await guard.supa
    .from('edge_devices').select('id, store_id, stores(tenant_id)').eq('id', edge_id).maybeSingle()
  if (!edge) return NextResponse.json({ error: 'edge_not_found' }, { status: 404 })
  const tenant_id = (edge as { stores?: { tenant_id?: string } }).stores?.tenant_id
  if (!tenant_id) return NextResponse.json({ error: 'edge_has_no_tenant' }, { status: 400 })

  const svc = createSupabaseService()
  // 既存の有効ライセンスがあれば差し替え（版 +1）、無ければ新規。
  const { data: cur } = await svc
    .from('licenses').select('id, license_version').eq('edge_id', edge_id).eq('status', 'active').maybeSingle()

  const meta = {
    org_name: org_name ?? null, max_cameras: max_cameras ?? null,
    expires_at: expires_at ?? null, bound_mac: bound_mac ?? null, notes: notes ?? null,
  }

  let id: string
  if (cur) {
    const { error } = await svc.from('licenses').update({
      ...meta, license_blob, license_version: cur.license_version + 1, updated_at: new Date().toISOString(),
    }).eq('id', cur.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    id = cur.id
  } else {
    const { data, error } = await svc.from('licenses').insert({
      edge_id, store_id: edge.store_id ?? null, tenant_id, ...meta, license_blob,
      created_by: guard.user.id,
    }).select('id').single()
    if (error) {
      const dup = error.code === '23505'
      return NextResponse.json({ error: dup ? 'active_license_exists' : error.message }, { status: dup ? 409 : 500 })
    }
    id = data.id
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: cur ? 'license.reissue' : 'license.issue',
    targetType: 'edge',
    targetId: edge_id,
    storeId: await storeIdForEdge(guard.supa, edge_id),
    changes: { org_name: meta.org_name, max_cameras: meta.max_cameras, expires_at: meta.expires_at },
  })
  return NextResponse.json({ ok: true, id })
}
