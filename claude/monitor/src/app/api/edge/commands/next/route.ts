/**
 * GET /api/edge/commands/next — HTTP 専用アップリンクの保留コマンド取得
 *
 * Phase 2a（NVMS/docs/UPLINK_SPEC.md §4.2）。従来エッジの realtime.ts が
 * Supabase 直読みでやっている「pending_command を読む → 受領を
 * edge_command_runs に残す → スロットをクリアする」を、サーバ側で
 * まとめて代行する。クライアントは「もらったら実行するだけ」。
 *
 * クリアは request_id 一致を条件にする（読み取りとクリアの間に管理画面が
 * 新しいコマンドを書いた場合、その新コマンドを消さない。次のポーリングで
 * 拾われる）。受領記録の失敗は実行を止めない — 従来エッジと同じ扱いで、
 * 記録は監視のためであって実行の前提条件ではない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('edge_devices')
    .select('pending_command')
    .eq('id', edge.id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cmd = data?.pending_command as { action?: string; request_id?: string } | null
  if (!cmd || typeof cmd.request_id !== 'string' || typeof cmd.action !== 'string') {
    return new NextResponse(null, { status: 204 })
  }

  await svc
    .from('edge_command_runs')
    .insert({ request_id: cmd.request_id, edge_id: edge.id, action: cmd.action })

  await svc
    .from('edge_devices')
    .update({ pending_command: null })
    .eq('id', edge.id)
    .eq('pending_command->>request_id', cmd.request_id)

  return NextResponse.json(cmd)
}
