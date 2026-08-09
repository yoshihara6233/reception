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
 *
 * さらに、ライブ画像（`/api/edges/**` を1〜2秒ごとにポーリング）は非許可パスなので、
 * 1フレームごとに `getUser()`＋`admin_users` 1行引きが走っていた。判定をトークン単位で
 * 30秒メモ化して往復を削る（理由と代償は `lib/auth/token-cache.ts` 冒頭）。
 * **境界そのものは動かさない** — キャッシュは実検証の再実行を省くだけで、判定は同じ。
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createTokenCache, hashToken, jwtExpiresAtMs } from '@/lib/auth/token-cache'

/**
 * トークン → 「手荷物検査店長か」。
 * null は未ログイン（＝このミドルウェアは素通しし、各ページの getUser に委ねる）。
 */
const roleCache = createTokenCache<boolean | null>()

/** テスト用（ロールを差し替えたときに前のテストの判定を持ち越さない）。 */
export function resetMiddlewareRoleCache(): void {
  roleCache.reset()
}

// 手荷物検査店長に許可するパス接頭辞（これ以外は遮断）。
const ALLOW_PREFIXES = [
  '/baggage', '/kiosk',
  '/api/baggage', '/api/auth', '/api/server-time',
  '/login', '/logout', '/forgot-password', '/reset-password',
  // Service Worker の本体。isStaticAsset は拡張子 .js を静的扱いしないので、
  // これが無いと手荷物検査店長のときだけ /sw-v2.js が /baggage へリダイレクトされ、
  // ブラウザが "script resource is behind a redirect" で登録を拒む。
  // **iPad キオスクで使うのがまさにこのロール**で、PWA/オフラインが効かなくなる。
  // 2026-08-09、E2E のログに出た registration failed から判明。
  '/sw.js', '/sw-v2.js',
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

  // access_token は cookie から読むだけ＝往復ゼロ。`session.user` は未検証なので触らない。
  const { data: { session } } = await supa.auth.getSession()
  const token = session?.access_token ?? null
  const tokenHash = token ? await hashToken(token) : null

  let isBaggageManager: boolean | null
  const hit = tokenHash ? roleCache.read(tokenHash, 'role') : undefined
  if (hit) {
    isBaggageManager = hit.value
  } else {
    const { data: { user } } = await supa.auth.getUser()
    if (!user) {
      isBaggageManager = null
    } else {
      const { data: profile, error } = await supa
        .from('admin_users').select('role').eq('auth_user_id', user.id).single()
      // 参照できなかった（瞬断など）ときは従来どおり素通しし、**覚えない**。
      // ここで false を30秒持つと、直後に境界が効かなくなる窓を自分で作ってしまう。
      if (error) return res
      isBaggageManager = profile?.role === 'baggage_manager'
    }
    if (tokenHash && token) {
      roleCache.write(tokenHash, 'role', isBaggageManager, jwtExpiresAtMs(token))
    }
  }

  if (isBaggageManager === null) return res  // 未ログインは各ページの getUser がログインへ誘導。
  if (!isBaggageManager) return res          // 通常ロールは制限しない。

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
