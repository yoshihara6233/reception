/**
 * エッジ ブートストラップ（鍵ローテ無停止同期 / Phase A）。
 *
 * エッジが `x-device-token` で認証し、現行の Supabase URL + service key を取得する。
 * これにより Supabase 鍵をローテしても、エッジの .env を手で書き換えずに追従できる
 * （エッジは起動時＆定期＆heartbeat失敗時に本エンドポイントを叩いてメモリ上の鍵を更新）。
 *
 * 認証: edge_devices.device_token と一致するトークンのみ。検証は monitor の env キー
 * (createSupabaseService)で行うので、Vercel 側の鍵を更新すれば常に現行値を配れる。
 *
 * ⚠ セキュリティ: 有効な device_token 保持者に master(service_role) キーを返す。エッジは
 *   元々この鍵を保持しているため新たな露出面ではないが、将来は edge 専用のスコープ付き
 *   鍵に置き換えるのが望ましい（device_token 漏洩時の影響を限定するため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.headers.get('x-device-token')
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'server not configured' }, { status: 503 })

  // device_token を検証（monitor の env キーで RLS バイパス参照）。
  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id')
    .eq('device_token', token)
    .single()
  if (error || !data) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  return NextResponse.json({
    edge_id:                   data.id,
    supabase_url:              url,
    supabase_service_role_key: key,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
