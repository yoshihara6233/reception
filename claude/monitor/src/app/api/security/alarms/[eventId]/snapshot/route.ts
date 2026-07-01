/**
 * 発報スナップの署名URLプロキシ（Phase B・巡回プロキシと同形）。
 *
 *     GET /api/security/alarms/<eventId>/snapshot
 *
 *  1. monitor セッションを確認。
 *  2. alarm_events を RLS 越しに読み（可視性チェック＝その発報を見られるユーザのみ）。
 *  3. security-snapshots の `alarms/<eventId>.<ext>` を Service Role で署名。
 *  4. 短命署名URLへ 302 リダイレクト。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET     = 'security-snapshots'
const SIGNED_TTL = 60

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // RLS-gated: 見られる発報のみ行が返る。
  const { data: ev, error } = await supa
    .from('alarm_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle()
  if (error || !ev) return new NextResponse('Not Found', { status: 404 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[security/alarms/snapshot] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  for (const ext of ['jpg', 'png'] as const) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(`alarms/${eventId}.${ext}`, SIGNED_TTL)
    if (signed?.signedUrl) {
      return NextResponse.redirect(signed.signedUrl, {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }
  return new NextResponse('Snapshot not found', { status: 404 })
}
