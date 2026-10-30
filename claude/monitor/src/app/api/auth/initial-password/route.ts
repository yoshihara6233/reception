/**
 * 仮のパスワードを本人のパスワードに変える (/login/password の画面が使う・2026-10-30・ASVS 6.4.1)。
 *
 * GET  → { state: 'none' | 'pending' | 'expired', expiresAt: string | null }
 * POST { password } → { ok: true }   仮のパスワードの印を外し、セッションを新しくする
 *
 * /api/auth は middleware の仮のパスワードの確認の外 (変える前に呼ぶため)。ログインしていない要求は 401。
 * 多要素を登録している人は、番号を確かめてから (aal2) でないと変えさせない。
 * 印 (app_metadata) は本人には書けないので、外すのはサービスの接続で行う。
 */
import { NextRequest } from 'next/server'
import { passwordProblem } from '@/lib/auth/password-policy'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { authJson, readJson, rejectCrossSite } from '@/lib/auth/server-auth'
import { mfaPending } from '@/lib/auth/mfa'
import { CLEARED_INITIAL_PASSWORD, INITIAL_PASSWORD_KEY, initialPasswordState } from '@/lib/auth/initial-password'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'unauthenticated' }, 401)
  const state = initialPasswordState(user)
  const raw = user.app_metadata?.[INITIAL_PASSWORD_KEY]
  return authJson({ state, expiresAt: state === 'none' || typeof raw !== 'string' ? null : raw })
}

export async function POST(req: NextRequest) {
  const cross = rejectCrossSite(req, '/api/auth/initial-password')
  if (cross) return cross
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return authJson({ error: 'ログインし直してください。' }, 401)

  const state = initialPasswordState(user)
  if (state === 'none') return authJson({ ok: true })   // もう変えてある (押し直し)
  if (state === 'expired') {
    return authJson({ error: '仮のパスワードの有効期限が過ぎています。管理者にパスワードの再発行を依頼してください。' }, 403)
  }
  const { data: { session } } = await supa.auth.getSession()
  if (mfaPending(user, session?.access_token ?? null)) {
    return authJson({ error: '先に認証アプリの番号を確かめてください。' }, 401)
  }

  const body = await readJson(req)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8 || password.length > 1024) {
    return authJson({ error: 'パスワードは8文字以上で入力してください。' }, 400)
  }

  // 製品の名前・語に数字を足しただけ・メールの名前の部分を含むものを断る (ASVS 6.2.11)
  const problem = passwordProblem(password, user.email)
  if (problem) return authJson({ error: problem }, 400)

  const { error } = await supa.auth.updateUser({ password })
  if (error) {
    const msg = error.code === 'same_password'
      ? '仮のパスワードと同じパスワードは使えません。'
      : error.code === 'weak_password'
        ? 'パスワードが弱すぎます。長くするか、文字の種類を増やしてください。'
        : error.code === 'reauthentication_needed'
          ? 'ログインしてから時間が経っています。もう一度ログインしてからお試しください。'
          : 'パスワードを変更できませんでした。別のパスワードでお試しください。'
    return authJson({ error: msg }, 400)
  }

  const { error: metaErr } = await createSupabaseService().auth.admin.updateUserById(user.id, {
    app_metadata: CLEARED_INITIAL_PASSWORD,
  })
  if (metaErr) {
    // パスワードは変わったが印が残った。次のログインでもう一度この画面になる (変えれば外れる)
    return authJson({ error: 'パスワードは変更しましたが、設定の更新に失敗しました。もう一度お試しください。' }, 500)
  }
  // トークンを新しくする (middleware の判定はトークンごとに 30 秒覚えているため、古いトークンだと
  // 変えた直後もこの画面へ戻される)
  await supa.auth.refreshSession().catch(() => {})
  return authJson({ ok: true })
}
