/**
 * パスワードの再設定の続き (2026-10-29 にブラウザからサーバへ・ASVS 3.3.4・6.2.3)。
 *
 * GET  → { ok: boolean }        今のセッションが最近の再設定の番号で入ったものか (lib/auth/recovery-session.ts)
 * POST { password } → { ok: true }  再設定のセッションでだけパスワードを書き換え、サインアウトする
 *
 * 普通のログインのセッションでは書き換えさせない (今のパスワードを聞かずに乗っ取れるため)。
 */
import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isRecentRecoverySession } from '@/lib/auth/recovery-session'
import { authJson, readJson, rejectCrossSite } from '@/lib/auth/server-auth'

export const dynamic = 'force-dynamic'

/** 確かめた利用者の、再設定のセッションのアクセストークン (そうでなければ null)。 */
async function recoveryToken(supa: Awaited<ReturnType<typeof createSupabaseServer>>): Promise<string | null> {
  const { data: { user } } = await supa.auth.getUser()   // 署名と失効を先に確かめる
  if (!user) return null
  const { data: { session } } = await supa.auth.getSession()
  const token = session?.access_token ?? null
  return isRecentRecoverySession(token) ? token : null
}

export async function GET() {
  const supa = await createSupabaseServer()
  return authJson({ ok: !!(await recoveryToken(supa)) })
}

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/recovery')
  if (cross) return cross
  const body = await readJson(req)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8 || password.length > 1024) {
    return authJson({ error: 'パスワードは8文字以上で入力してください。' }, 400)
  }
  const supa = await createSupabaseServer()
  if (!(await recoveryToken(supa))) {
    return authJson({ error: '再設定のリンクの有効時間を過ぎました。お手数ですが、もう一度メールを送ってください。' }, 401)
  }
  const { error } = await supa.auth.updateUser({ password })
  if (error) {
    const msg = error.code === 'same_password'
      ? '今と同じパスワードは使えません。'
      : error.code === 'weak_password'
        ? 'パスワードが弱すぎます。長くするか、文字の種類を増やしてください。'
        : 'パスワードを変更できませんでした。別のパスワードでお試しください。'
    return authJson({ error: msg }, 400)
  }
  // 新しいパスワードで入り直してもらう
  await supa.auth.signOut().catch(() => {})
  return authJson({ ok: true })
}
