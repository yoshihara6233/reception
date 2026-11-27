/**
 * GET /api/edge/os-update — OS 更新ファイルの配信（接続仕様 §14・E-4-8）
 *
 * os_update を名乗る拠点（G・VMS 1.0.0 以降）が 10 分ごとに尋ねる。
 *   204 … この拠点へ届けるものは無い（選んでいない・取り下げた・名乗りが無い・表がまだ無い）
 *   200 { signed } … 運営がこの拠点へ届けると選んだ、当社の署名つきの 1 行そのもの
 *
 * - **届くだけで当たらない**（始めるのは拠点の管理者）ので、時間帯は見ない。
 * - 中身は作り変えない。署名を確かめるのは拠点（埋め込みの公開鍵）。
 * - 取り下げるまで同じ 1 行を返す（拠点は同じ番号を受け取り直さない）。
 * - migration の前の DB（列・表が無い）では 204 にする。拠点の死活を落とさない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { hasCapability } from '@/lib/edge/capabilities'
import { CAP_OS_UPDATE, OS_UPDATE_MAX_SIGNED } from '@/lib/admin/os-update-files'

export const dynamic = 'force-dynamic'

const none = () => new NextResponse(null, { status: 204 })

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: row, error } = await svc
    .from('edge_devices')
    .select('agent_version, capabilities, os_update_file_id')
    .eq('id', edge.id)
    .maybeSingle()
  if (error || !row || !row.os_update_file_id) return none()
  // 名乗りの無い拠点には届けない（古い版は尋ねてこないが、受け口でも断る）
  if (!hasCapability(row, CAP_OS_UPDATE)) return none()

  const { data: file, error: fileErr } = await svc
    .from('os_update_files')
    .select('signed, withdrawn_at')
    .eq('id', row.os_update_file_id)
    .maybeSingle()
  if (fileErr || !file || file.withdrawn_at) return none()
  const signed = String(file.signed ?? '')
  if (!signed || Buffer.byteLength(signed, 'utf8') > OS_UPDATE_MAX_SIGNED) return none()

  return NextResponse.json({ signed }, { headers: { 'Cache-Control': 'no-store' } })
}
