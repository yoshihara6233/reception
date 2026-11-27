/**
 * OS 更新ファイルの届け先と取り下げ（接続仕様 §14・E-4-8）— 運営 (super_admin) だけ。
 *
 * PUT    — 届け先を決める: { edge_ids } に挙げた拠点へこのファイルを届け、
 *          今このファイルを届けていて挙がっていない拠点からは外す。
 *          **os_update を名乗らない拠点は選べない**（届かないものを「届けた」と見せない）。
 *          1 拠点に届くのは 1 つなので、別のファイルを届けていた拠点はこのファイルに替わる。
 * DELETE — 取り下げ: 届け先をすべて外し、withdrawn_at を入れる（行は残す）。
 *          すでに拠点が受け取った分は取り消せない（拠点の画面で取りやめる）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { invalidInput } from '@/lib/api/invalid-input'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { dbErrorCode } from '@/lib/api/db-error'
import { hasCapability } from '@/lib/edge/capabilities'
import { CAP_OS_UPDATE } from '@/lib/admin/os-update-files'

export const dynamic = 'force-dynamic'

const WHERE = '/api/admin/os-updates/[id]'
const PutBody = z.object({ edge_ids: z.array(z.string().uuid()).max(2000) })

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = PutBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, guard.user.id)
  const want = [...new Set(parsed.data.edge_ids)]

  const svc = createSupabaseService()
  const { data: file } = await svc.from('os_update_files').select('id, file_id, withdrawn_at').eq('id', id).maybeSingle()
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (file.withdrawn_at) return NextResponse.json({ error: 'withdrawn' }, { status: 409 })

  const { data: edges, error: edgeErr } = await svc
    .from('edge_devices')
    .select('id, agent_version, capabilities, os_update_file_id')
    .like('agent_version', 'nvmsd/%')
    .limit(5000)
  if (edgeErr) return NextResponse.json({ error: dbErrorCode(edgeErr, WHERE) }, { status: 500 })

  const byId = new Map((edges ?? []).map((e) => [e.id as string, e]))
  const unknown = want.filter((eid) => !byId.has(eid))
  if (unknown.length > 0) return NextResponse.json({ error: 'unknown_edge', edges: unknown.length }, { status: 400 })
  const incapable = want.filter((eid) => !hasCapability(byId.get(eid), CAP_OS_UPDATE))
  if (incapable.length > 0) return NextResponse.json({ error: 'not_capable', edges: incapable.length }, { status: 400 })

  const add = want.filter((eid) => byId.get(eid)?.os_update_file_id !== id)
  const remove = (edges ?? []).filter((e) => e.os_update_file_id === id && !want.includes(e.id as string)).map((e) => e.id as string)
  const now = new Date().toISOString()

  if (add.length > 0) {
    const { error } = await svc.from('edge_devices').update({ os_update_file_id: id, os_update_assigned_at: now }).in('id', add)
    if (error) return NextResponse.json({ error: dbErrorCode(error, WHERE) }, { status: 500 })
  }
  if (remove.length > 0) {
    const { error } = await svc.from('edge_devices').update({ os_update_file_id: null, os_update_assigned_at: now }).in('id', remove)
    if (error) return NextResponse.json({ error: dbErrorCode(error, WHERE) }, { status: 500 })
  }
  if (add.length > 0 || remove.length > 0) {
    await recordAudit(svc, {
      actorUserId: guard.user.id, action: 'os_update.deliver', targetType: 'os_update_file',
      targetId: id, storeId: null,
      changes: { file_id: file.file_id, added: add, removed: remove, total: want.length },
    })
  }
  return NextResponse.json({ ok: true, added: add.length, removed: remove.length, total: want.length })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()
  const { data: file } = await svc.from('os_update_files').select('id, file_id, withdrawn_at').eq('id', id).maybeSingle()
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const now = new Date().toISOString()
  // 先に届け先を外す（取り下げの印だけ入って届け先が残る、という半端な状態を作らない）
  const { data: cleared, error: clearErr } = await svc
    .from('edge_devices')
    .update({ os_update_file_id: null, os_update_assigned_at: now })
    .eq('os_update_file_id', id)
    .select('id')
  if (clearErr) return NextResponse.json({ error: dbErrorCode(clearErr, WHERE) }, { status: 500 })
  if (!file.withdrawn_at) {
    const { error } = await svc.from('os_update_files').update({ withdrawn_at: now }).eq('id', id)
    if (error) return NextResponse.json({ error: dbErrorCode(error, WHERE) }, { status: 500 })
  }
  await recordAudit(svc, {
    actorUserId: guard.user.id, action: 'os_update.withdraw', targetType: 'os_update_file',
    targetId: id, storeId: null,
    changes: { file_id: file.file_id, cleared: (cleared ?? []).length },
  })
  return NextResponse.json({ ok: true, cleared: (cleared ?? []).length })
}
