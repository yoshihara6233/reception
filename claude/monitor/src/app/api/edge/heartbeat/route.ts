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
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { status, agent_version, mac, applied_config_version, pkg_format, pkg_arch } = parsed.data

  const payload: Record<string, unknown> = {
    status,
    last_seen_at: new Date().toISOString(),
  }
  if (agent_version) payload.agent_version = agent_version
  if (mac) payload.reported_mac = mac
  if (applied_config_version !== undefined) payload.applied_config_version = applied_config_version
  if (pkg_format) payload.pkg_format = pkg_format
  if (pkg_arch) payload.pkg_arch = pkg_arch

  const { error } = await createSupabaseService()
    .from('edge_devices')
    .update(payload)
    .eq('id', edge.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
