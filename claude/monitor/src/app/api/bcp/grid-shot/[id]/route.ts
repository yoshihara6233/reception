/**
 * Phase 2b — bcp_grid_shots（16分割合成タイムライン）の画像プロキシ。
 *
 * /api/bcp/clip/[id]（F76）と同型: セッション必須 → 利用者スコープの
 * bcp_grid_shots 読み（RLS = 親イベントの店舗可視性）で認可 → Service Role で
 * 60 秒の署名 URL を作り 302。ストリーミングせずリダイレクトする理由も同じ
 * （詳細ページはページ数 × 8 枚を並べるので Next.js を経由させない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET     = 'bcp-clips'
const SIGNED_TTL = 60   // seconds

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: shotId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // 利用者スコープで読む＝RLS が「見てよいイベントか」を判定する。
  const { data: shot } = await supa
    .from('bcp_grid_shots')
    .select('id, storage_path, upload_status')
    .eq('id', shotId)
    .maybeSingle()
  if (!shot) return new NextResponse('Not Found', { status: 404 })
  if (shot.upload_status !== 'completed' || !shot.storage_path) {
    return new NextResponse('Shot not available', { status: 410 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[bcp/grid-shot] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(shot.storage_path, SIGNED_TTL)
  if (signErr || !signed?.signedUrl) {
    console.error('[bcp/grid-shot] signing failed', signErr?.message)
    return new NextResponse('Signing failed', { status: 502 })
  }
  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
