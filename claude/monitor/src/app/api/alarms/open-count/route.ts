/**
 * GET /api/alarms/open-count — 未完了（未対応/対応中）発報の件数
 *
 * 上段メニューの ALARM を赤字化するために、ヘッダが軽量ポーリングで取得する。
 * RLS 越し（セッション）なので、閲覧可能な店舗の発報のみ数える。
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 }, { headers: { 'Cache-Control': 'no-store' } })

  const { count } = await supa
    .from('alarm_events')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'closed')

  return NextResponse.json({ count: count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
}
