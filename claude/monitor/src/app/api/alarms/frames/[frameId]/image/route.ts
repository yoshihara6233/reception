/**
 * 発報前後スナップ 1 枚の署名 URL プロキシ（PB7・発報スナッププロキシと同形）。
 *
 *     GET /api/alarms/frames/<frameId>/image
 *
 *  1. monitor セッションを確認。
 *  2. alarm_frames を RLS 越しに読み（可視性チェック＝その発報を見られるユーザのみ）。
 *  3. security-snapshots の storage_path を Service Role で署名。
 *  4. 短命署名 URL へ 302 リダイレクト。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET     = 'security-snapshots'
const SIGNED_TTL = 60

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ frameId: string }> },
) {
  const { frameId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // RLS-gated: 見られる発報のフレームのみ行が返る。
  // 閲覧アクセスの記録は発報詳細ページ側（発報単位・G3）で行うため、ここでは記録しない
  // （フレーム1枚ごとに記録すると1発報で16〜24行になり監査ログが読みにくくなるため）。
  const { data: frame, error } = await supa
    .from('alarm_frames')
    .select('storage_path')
    .eq('id', frameId)
    .maybeSingle()
  if (error || !frame?.storage_path) return new NextResponse('Not Found', { status: 404 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[alarms/frames/image] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(frame.storage_path, SIGNED_TTL)
  if (!signed?.signedUrl) return new NextResponse('Snapshot not found', { status: 404 })

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
