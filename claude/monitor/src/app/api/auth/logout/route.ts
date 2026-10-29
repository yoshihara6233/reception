/**
 * POST /api/auth/logout — サインアウト (セッションを失効させ、HttpOnly の Cookie を消す)。
 *
 * 以前はブラウザの Supabase クライアントで行っていた (2026-10-29 にサーバへ・ASVS 3.3.4)。
 * 失効は以前と同じく、その利用者のすべてのセッション (Supabase の既定 global)。
 * ログインしていなくても 200 (押し直し・期限切れのときに画面を止めない)。
 *
 * 応答に Clear-Site-Data: "cache" を付け、ブラウザの HTTP の控えと戻る用の控え (bfcache) を消す
 * (2026-10-29・自主診断 ASVS 14.3.1)。Service Worker の Cache Storage は画面の側で消す
 * (lib/pwa/client-cache.ts の signOutAndLeave)。"storage" は SW の登録まで消して通知 (Web Push) が
 * 止まるので使わない。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authJson, rejectCrossSite } from '@/lib/auth/server-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/logout')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (user) await supa.auth.signOut().catch(() => {})
  const res = authJson({ ok: true })
  res.headers.set('Clear-Site-Data', '"cache"')
  return res
}
