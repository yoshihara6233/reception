/**
 * アクセス境界ミドルウェア。
 *
 * 手荷物検査店長（admin_users.role = 'baggage_manager'）は /baggage 系のみ許可し、
 * それ以外（ライブ視聴を含む監視機能・/admin・/stores 等）へアクセスすると /baggage へ
 * リダイレクト（API は 403）。ライブ視聴時間を増やさないための中央強制。
 *
 * 最適化: 許可プレフィックスへのアクセスでは admin_users 参照を行わない
 * （ロール判定は非許可パスに来た認証済みリクエストのみ）。ページ側の getUser が
 * 従来どおりセッションを扱うため、許可パスで getUser を省いても認証は成立する。
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 手荷物検査店長に許可するパス接頭辞（これ以外は遮断）。
const ALLOW_PREFIXES = [
  '/baggage', '/kiosk',
  '/api/baggage', '/api/auth', '/api/server-time',
  '/login', '/logout', '/forgot-password', '/reset-password',
]

function isAllowed(path: string): boolean {
  return ALLOW_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

// 静的アセット（/public 直下の画像・manifest 等）は境界の対象外。
// ただし /api/ 配下は拡張子に関わらず必ず境界にかける（プロキシが末尾 .png 等を
// 受けても迂回させない）。
function isStaticAsset(path: string): boolean {
  return !path.startsWith('/api/') && /\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$/.test(path)
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  // 許可パス・静的アセットはロール参照なしで通す（キオスク/履歴の常用経路を軽くする）。
  if (isAllowed(path) || isStaticAsset(path)) return NextResponse.next()

  const res = NextResponse.next()
  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  )

  const { data: { user } } = await supa.auth.getUser()
  if (!user) return res   // 未ログインは各ページの getUser がログインへ誘導。

  const { data: profile } = await supa
    .from('admin_users').select('role').eq('auth_user_id', user.id).single()
  if (profile?.role !== 'baggage_manager') return res   // 通常ロールは制限しない。

  // 手荷物検査店長が非許可パスに来た → API は 403、ページは /baggage へ。
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'forbidden_baggage_manager' }, { status: 403 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/baggage'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  // Next 内部アセットのみ除外。/api や画像URLは middleware 本体の isStaticAsset で判定し、
  // /api/*.png のような迂回を作らない。
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
