/**
 * GET /api/edge/agent-update — nvmsd の自動更新指示（OTA_SPEC §4.1）
 *
 * nvmsd が 10 分ごとにポーリングする。204 = 更新なし
 * （目標未設定・稼働中と同一・時間帯外・リリース未登録）。
 * 200 のとき { version, url(presigned GET 1h), sha256, sig, bytes }。
 *
 * 判断はすべてサーバ側:
 * - 「稼働中と同一か」は heartbeat が書いた agent_version（nvmsd/ 接頭辞を剥がす）
 *   で見る — nvmsd から追加の申告を受けない。
 * - 時間帯（JST・既定 02:00-05:00）もここで判定。update_force=true は時間帯を
 *   無視する 1 回きりの指示で、目標到達を確認したら自動で降ろす。
 * - バージョンは一致/不一致しか見ない（semver 解釈をしない・OTA_SPEC §2）。
 *   「戻す」配備も同じ仕組みで成立する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { inUpdateWindow, nowJstMinutes } from '@/lib/edge/update-window'

export const dynamic = 'force-dynamic'

const BUCKET = 'nvmsd-releases'
const URL_TTL_SEC = 3600

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: row } = await svc
    .from('edge_devices')
    .select('desired_agent_version, agent_version, update_window_start, update_window_end, update_force')
    .eq('id', edge.id)
    .maybeSingle()
  if (!row) return new NextResponse(null, { status: 204 })

  const desired = row.desired_agent_version
  if (!desired) return new NextResponse(null, { status: 204 })

  const running = (row.agent_version ?? '').replace(/^nvmsd\//, '')
  if (running === desired) {
    // 目標到達。即時フラグが残っていたら降ろす（1 回きりの指示）。
    if (row.update_force) {
      await svc.from('edge_devices').update({ update_force: false }).eq('id', edge.id)
    }
    return new NextResponse(null, { status: 204 })
  }

  if (!row.update_force && !inUpdateWindow(nowJstMinutes(), row.update_window_start, row.update_window_end)) {
    return new NextResponse(null, { status: 204 })
  }

  const { data: rel } = await svc
    .from('nvmsd_releases')
    .select('version, storage_path, sha256, sig, bytes')
    .eq('version', desired)
    .maybeSingle()
  if (!rel) {
    // 目標版がリリース台帳に無い＝登録漏れ。配れないので黙って 204
    // （管理 UI は台帳から選ばせるので通常は起きない）。
    console.warn(`agent-update: release not found for desired version "${desired}" (edge ${edge.id})`)
    return new NextResponse(null, { status: 204 })
  }

  const { data: signed, error: signErr } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(rel.storage_path, URL_TTL_SEC)
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'sign_failed' }, { status: 500 })
  }

  return NextResponse.json({
    version: rel.version,
    url: signed.signedUrl,
    sha256: rel.sha256,
    sig: rel.sig,
    bytes: rel.bytes,
  })
}
