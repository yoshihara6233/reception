import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/auth/reset-link
 *
 * サービスロールキーで admin.generateLink を呼び出し、
 * 正しいリダイレクト先を含むパスワードリセットリンクを返す。
 * Supabase の Site URL 設定（localhost のまま）に依存しない。
 */
export async function POST(req: NextRequest) {
  try {
    const { email, redirectTo } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'email は必須です' }, { status: 400 })
    }

    // redirectTo が production ドメインかどうかを検証
    const allowed = [
      'https://reception-gray.vercel.app',
      process.env.NEXT_PUBLIC_SITE_URL,
    ].filter(Boolean)

    const origin = redirectTo ? new URL(redirectTo).origin : ''
    const isAllowed = allowed.some(a => origin === a) || origin.endsWith('.vercel.app')
    if (redirectTo && !isAllowed) {
      return NextResponse.json({ error: '許可されていないリダイレクト先です' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: redirectTo ?? 'https://reception-gray.vercel.app/admin/reset-password',
      },
    })

    if (error || !data?.properties?.action_link) {
      return NextResponse.json(
        { error: error?.message ?? 'リンクの生成に失敗しました' },
        { status: 400 },
      )
    }

    return NextResponse.json({ action_link: data.properties.action_link })
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
