/**
 * POST /api/edge/heartbeat — HTTP 専用アップリンク（nvmsd 内蔵）の生存報告
 *
 * Phase 2a（NVMS/docs/UPLINK_SPEC.md §4.1）。従来のエッジ端末は Supabase の
 * スコープトークンで edge_devices を直接 update するが、nvmsd 内蔵アップリンクは
 * Supabase を一切持たない設計（OEM 配布物に SaaS の SDK・鍵・スキーマ知識を
 * 埋めない）。その代わりにこの薄い受け口が同じ更新を代行する。
 *
 * agent_version の `nvmsd/` プレフィックスが「内蔵アップリンク」の印
 * （bootstrap・OTA 前提の点検から見分けるため。UPLINK_SPEC §4.1 で必須）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { sanitizeCapabilities, sanitizeSpecVersion } from '@/lib/edge/capabilities'

export const dynamic = 'force-dynamic'

const Body = z.object({
  status: z.enum(['idle', 'grid', 'live', 'vod', 'bcp', 'error', 'offline']),
  agent_version: z.string().max(100).optional(),
  // ライセンス束縛の対象（LICENSE_SPEC §4.2）。nvmsd が申告し、管理者が
  // これを見て G・VMS にライセンス発行を依頼する。任意（対応版だけ送る）。
  mac: z.string().max(64).optional(),
  // 適用できた設定版（CONFIG_PUSH_SPEC §3.2）。desired と一致で「反映済み」。
  applied_config_version: z.number().int().min(0).optional(),
  // OTA の配り分け（形式・CPU 種別）。nvmsd が更新の適用役と同じ判定で名乗る。
  pkg_format: z.enum(['deb', 'rpm']).optional(),
  pkg_arch: z.enum(['amd64', 'arm64']).optional(),
  // 版と使える機能の名乗り（GVMS_CLOUD_SPEC §2）。**ここでは型を縛らない** —
  // 形の崩れた名乗りで heartbeat ごと 400 にすると拠点が「停止」に見える。
  // 中身は sanitize* で読めた分だけ使う。
  spec_version: z.unknown().optional(),
  capabilities: z.unknown().optional(),
  // 遠隔視聴の状況（§5.5）。送っていなければ省かれる。
  video: z.unknown().optional(),
})

const VideoStats = z.object({
  sessions: z.number().int().min(0).max(10_000),
  kbps: z.number().int().min(0).max(10_000_000),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { status, agent_version, mac, applied_config_version, pkg_format, pkg_arch } = parsed.data
  const video = VideoStats.safeParse(parsed.data.video)

  const payload: Record<string, unknown> = {
    status,
    last_seen_at: new Date().toISOString(),
  }
  if (agent_version) payload.agent_version = agent_version
  if (mac) payload.reported_mac = mac
  if (applied_config_version !== undefined) payload.applied_config_version = applied_config_version
  if (pkg_format) payload.pkg_format = pkg_format
  if (pkg_arch) payload.pkg_arch = pkg_arch
  // 名乗りは毎回そのまま写す。省かれたら null（＝名乗り無し）に戻す — 0.1.67 以前へ
  // 戻した拠点に、古い名乗りのまま動画のボタンを出し続けないため。
  const announce: Record<string, unknown> = {
    spec_version: sanitizeSpecVersion(parsed.data.spec_version),
    capabilities: sanitizeCapabilities(parsed.data.capabilities),
    video_sessions_now: video.success ? video.data.sessions : 0,
    video_kbps: video.success ? video.data.kbps : 0,
    video_reported_at: payload.last_seen_at,
  }

  const svc = createSupabaseService()
  let { error } = await svc.from('edge_devices').update({ ...payload, ...announce }).eq('id', edge.id)
  // **名乗りの列が無い（migration の前にデプロイされた）ときも死活は落とさない。**
  // 本番の migration は手で当てるので、順番を間違えると全拠点が「停止」に見える。
  // 列が無いと PostgREST は PGRST204 を返す — そのときだけ従来の列で書き直す。
  if (error?.code === 'PGRST204') {
    ;({ error } = await svc.from('edge_devices').update(payload).eq('id', edge.id))
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
