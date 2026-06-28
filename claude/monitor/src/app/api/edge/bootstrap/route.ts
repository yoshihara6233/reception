/**
 * エッジ ブートストラップ（鍵ローテ無停止同期 / Phase A + スコープ鍵化 Phase B1）。
 *
 * エッジが `x-device-token` で認証し、現行の Supabase URL + service key を取得する。
 * これにより Supabase 鍵をローテしても、エッジの .env を手で書き換えずに追従できる。
 *
 * Phase B1（エッジ専用スコープ鍵化）: このエッジ専用の Supabase Auth ユーザで
 * signInWithPassword し、短命アクセストークン(≤1h)を `scoped_access_token` /
 * `scoped_expires_at` として追加で返す。エッジは edge_jobs だけをこのトークン
 * (authenticated/RLS スコープ)で叩く。トークンの app_metadata.edge_id を RLS が見て、
 * 自分宛の行だけに絞る。auth ユーザ未provisioning のエッジには scoped を返さない
 * （従来 service_role 経路のまま＝後方互換・無停止）。
 *
 * 認証: edge_devices.device_token と一致するトークンのみ。
 *
 * ⚠ 移行中は service_role も従来通り返す（未移行テーブル用）。全テーブル移行完了時に
 *   service_role 返却を撤廃し、device_token 漏洩時の影響限定を完成させる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { decryptSecret } from '@intereco/shared'

/** エッジ auth ユーザのメール（edge_id から決定的に導出。provisioning と一致させる）。 */
function edgeAuthEmail(edgeId: string): string {
  return `edge+${edgeId}@edge.intereco.local`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.headers.get('x-device-token')
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ error: 'server not configured' }, { status: 503 })

  // device_token を検証（monitor の env キーで RLS バイパス参照）。
  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id, auth_user_id, auth_password_enc')
    .eq('device_token', token)
    .single()
  if (error || !data) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const body: {
    edge_id: string
    supabase_url: string
    supabase_service_role_key: string
    scoped_access_token?: string
    scoped_expires_at?: number
  } = {
    edge_id: data.id,
    supabase_url: url,
    supabase_service_role_key: key,
  }

  // Phase B1: provisioning 済みなら短命スコープトークンを発行して同梱。
  // 失敗しても 200（service_role 経路は維持）— 無停止のための後方互換。
  if (anon && data.auth_user_id && data.auth_password_enc) {
    try {
      const password = decryptSecret(data.auth_password_enc as string)
      const authClient = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: signIn, error: signErr } = await authClient.auth.signInWithPassword({
        email: edgeAuthEmail(data.id),
        password,
      })
      if (!signErr && signIn?.session?.access_token) {
        body.scoped_access_token = signIn.session.access_token
        body.scoped_expires_at = signIn.session.expires_at ?? undefined
      }
    } catch {
      // 復号/サインイン失敗は無視（scoped を返さないだけ）。
    }
  }

  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
