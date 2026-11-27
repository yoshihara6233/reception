/**
 * OS 更新ファイルの台帳（接続仕様 §14・E-4-8）— 運営 (super_admin) だけ。
 *
 * GET  — 登録済みのファイルと、届け先を選ぶための拠点の一覧。
 * POST — 登録: 当社が署名した 1 行（nvmsosu1.…）を**そのまま**預かる。形と中身を確かめ、
 *        環境変数 NVMS_UPDATE_PUBKEY があれば署名も確かめる（貼り間違いを登録の時点で断る）。
 *        最終的に署名を確かめるのは拠点。登録しただけでは、どの拠点にも届かない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { invalidInput } from '@/lib/api/invalid-input'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { dbErrorCode } from '@/lib/api/db-error'
import { OS_UPDATE_MAX_SIGNED, parseOsUpdateSigned } from '@/lib/admin/os-update-files'

export const dynamic = 'force-dynamic'

const FILE_COLS = 'id, file_id, title, advisory, cve, issued_at, packages, reboot, notes, created_at, withdrawn_at'
const EDGE_COLS = 'id, name, agent_version, capabilities, last_seen_at, os_vuln_urgent, os_vuln_routine, os_update_file_id, os_update_assigned_at, stores ( name, tenants ( name ) )'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const svc = createSupabaseService()
  const [files, edges] = await Promise.all([
    svc.from('os_update_files').select(FILE_COLS).order('created_at', { ascending: false }).limit(200),
    svc.from('edge_devices').select(EDGE_COLS).like('agent_version', 'nvmsd/%').order('name').limit(2000),
  ])
  if (files.error) return NextResponse.json({ error: dbErrorCode(files.error, '/api/admin/os-updates') }, { status: 500 })
  if (edges.error) return NextResponse.json({ error: dbErrorCode(edges.error, '/api/admin/os-updates') }, { status: 500 })
  return NextResponse.json({ files: files.data ?? [], edges: edges.data ?? [] })
}

const PostBody = z.object({
  signed: z.string().min(16).max(OS_UPDATE_MAX_SIGNED + 16),
  notes: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = PostBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, guard.user.id)

  const file = parseOsUpdateSigned(parsed.data.signed, process.env.NVMS_UPDATE_PUBKEY)
  if (!file.ok) return NextResponse.json({ error: file.error }, { status: 400 })

  const svc = createSupabaseService()
  const { data, error } = await svc.from('os_update_files').insert({
    file_id: file.body.id,
    title: file.body.title,
    advisory: file.body.advisory,
    cve: file.body.cve,
    issued_at: file.body.issued_at,
    packages: file.body.packages,
    reboot: file.body.reboot,
    signed: file.signed,
    notes: parsed.data.notes?.trim() || null,
    created_by: guard.user.id,
  }).select('id').single()
  if (error) {
    const dup = error.code === '23505'
    return NextResponse.json(
      { error: dup ? 'file_exists' : dbErrorCode(error, '/api/admin/os-updates') },
      { status: dup ? 409 : 500 },
    )
  }
  await recordAudit(svc, {
    actorUserId: guard.user.id, action: 'os_update.register', targetType: 'os_update_file',
    targetId: data.id, storeId: null,
    changes: { file_id: file.body.id, packages: file.body.packages.length, reboot: file.body.reboot, signature_checked: file.signatureChecked },
  })
  return NextResponse.json({ ok: true, id: data.id, file_id: file.body.id, signature_checked: file.signatureChecked })
}
