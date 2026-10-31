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
 * **多要素認証の確認（2026-10-28）**: 多要素を登録した利用者は、パスワードのあと番号を確かめる
 * まで（トークンが aal2 になるまで）非許可パスを使えない。画面は /login/mfa へ、API は 401。
 * 判定はロールと同じ getUser の結果から作り、同じキャッシュに載せる（往復を増やさない）。
 * 許可パス（ログイン・パスワード再設定・キオスク）は従来どおり見ない（lib/auth/mfa.ts）。
 *
 * **仮のパスワード（2026-10-30・ASVS 6.4.1）**: 管理者が決めたパスワードで入った人は、本人の
 * パスワードに変えるまで非許可パスを使えない。画面は /login/password へ、API は 403
 * （lib/auth/initial-password.ts）。判定は多要素と同じく getUser の結果から作る。
 *
 * さらに、ライブ画像（`/api/edges/**` を1〜2秒ごとにポーリング）は非許可パスなので、
 * 1フレームごとに `getUser()`＋`admin_users` 1行引きが走っていた。判定をトークン単位で
 * 30秒メモ化して往復を削る（理由と代償は `lib/auth/token-cache.ts` 冒頭）。
 * **境界そのものは動かさない** — キャッシュは実検証の再実行を省くだけで、判定は同じ。
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createTokenCache, hashToken, jwtExpiresAtMs } from '@/lib/auth/token-cache'
import { legacyRedirectTarget } from '@/lib/legacy-host'
import { appBaseUrl } from '@/lib/app-url'
import { isMfaEnrollmentPath, mfaEnrollmentRequired, mfaPending } from '@/lib/auth/mfa'
import { initialPasswordState } from '@/lib/auth/initial-password'
import { isForeignClientToken } from '@/lib/auth/foreign-client'
import { logSecurityEvent, requestIp } from '@/lib/security/events'
import { makeNonce, pageCsp } from '@/lib/security/csp'
import { SESSION_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options'
import { PREFIXED_COOKIES } from '@/lib/security/cookie-names'
import { isCrossSiteWrite } from '@/lib/security/fetch-metadata'

/** トークンについての判定（手荷物検査店長か・多要素の番号の確認が済んでいないか）。 */
interface Verdict {
  isBaggageManager: boolean
  mfaPending: boolean
  /** 登録が必須の役割なのに多要素を登録していない (lib/auth/mfa.ts) */
  mfaEnrollRequired?: boolean
  /** 拠点 (G・VMS) の OAuth クライアント向けに出したトークン。クラウドでは使わせない */
  foreignClient?: boolean
  /** 利用者のテナントが停止 (suspended) している。画面も API も使わせない (ASVS 7.4.2) */
  tenantSuspended?: boolean
  /** 管理者が決めた仮のパスワードのまま (本人のパスワードに変えるまで止める・ASVS 6.4.1) */
  passwordChangePending?: boolean
}

/**
 * トークン → 判定。
 * null は未ログイン（＝このミドルウェアは素通しし、各ページの getUser に委ねる）。
 */
const roleCache = createTokenCache<Verdict | null>()

/** テスト用（ロールを差し替えたときに前のテストの判定を持ち越さない）。 */
export function resetMiddlewareRoleCache(): void {
  roleCache.reset()
}

// 手荷物検査店長に許可するパス接頭辞（これ以外は遮断）。
const ALLOW_PREFIXES = [
  '/baggage', '/kiosk',
  '/api/baggage', '/api/auth', '/api/server-time',
  '/login', '/logout', '/forgot-password', '/reset-password', '/suspended',
  // Service Worker の本体。isStaticAsset は拡張子 .js を静的扱いしないので、
  // これが無いと手荷物検査店長のときだけ /sw-v2.js が /baggage へリダイレクトされ、
  // ブラウザが "script resource is behind a redirect" で登録を拒む。
  // **iPad キオスクで使うのがまさにこのロール**で、PWA/オフラインが効かなくなる。
  // 2026-08-09、E2E のログに出た registration failed から判明。
  '/sw.js', '/sw-v2.js',
  // 圏外のときに SW が出す画面。SW が install で先に取り込むので、ロールや多要素の確認で
  // 別の画面へ転送すると、その画面 (認証済みの HTML) を控えてしまう (ASVS 14.3.1)。
  '/offline',
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

/**
 * 入口。要求ごとの nonce を作って CSP を付け (lib/security/csp.ts・ASVS 3.4.3)、判定は route に任せる。
 * Next が nonce を読めるよう、次へ渡す要求の見出しにも CSP と x-nonce を載せる。
 */
export async function middleware(req: NextRequest) {
  // 別のサイトからの書き込み (CSRF) はどの受け口でも断る (lib/security/fetch-metadata.ts・ASVS 3.5.2)
  if (req.nextUrl.pathname.startsWith('/api/') && isCrossSiteWrite(req)) {
    logSecurityEvent({ kind: 'auth.cross_site', ip: requestIp(req.headers), path: req.nextUrl.pathname })
    return NextResponse.json({ error: 'cross_site' }, { status: 403 })
  }
  const nonce = makeNonce()
  const csp = pageCsp(nonce)
  const reqHeaders = new Headers(req.headers)
  reqHeaders.set('x-nonce', nonce)
  reqHeaders.set('content-security-policy', csp)
  const res = await route(req, () => NextResponse.next({ request: { headers: reqHeaders } }))
  res.headers.set('Content-Security-Policy', csp)
  // セッションの Cookie を __Host- の名前へ移した (2026-10-29)。以前の名前の Cookie (古いトークン) は
  // もう読まないので、ブラウザに残さない
  if (PREFIXED_COOKIES) {
    for (const c of req.cookies.getAll()) {
      if (/^sb-[a-z0-9]+-auth-token/.test(c.name)) res.cookies.delete(c.name)
    }
  }
  return res
}

async function route(req: NextRequest, next: () => NextResponse): Promise<NextResponse> {
  const path = req.nextUrl.pathname
  // 旧 URL の画面は新 URL へ（API・キオスクは除く・理由は lib/legacy-host.ts）。
  const legacy = legacyRedirectTarget(
    req.headers.get('host') ?? req.nextUrl.host, path, req.nextUrl.search, appBaseUrl())
  if (legacy) return NextResponse.redirect(legacy, 307)

  // 許可パス・静的アセットはロール参照なしで通す（キオスク/履歴の常用経路を軽くする）。
  if (isAllowed(path) || isStaticAsset(path)) return next()

  const res = next()
  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // 更新したトークンを書き戻すときも HttpOnly (lib/supabase/cookie-options.ts)
      cookieOptions: SESSION_COOKIE_OPTIONS,
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

  let verdict: Verdict | null
  const hit = tokenHash ? roleCache.read(tokenHash, 'role') : undefined
  if (hit) {
    verdict = hit.value
  } else {
    const { data: { user } } = await supa.auth.getUser()
    if (!user) {
      verdict = null
    } else {
      // getUser が同じトークンの署名と失効を確かめたあとなので、トークンの aal と client_id を信じてよい
      const pending = mfaPending(user, token)
      const pwPending = initialPasswordState(user) !== 'none'
      if (isForeignClientToken(token)) {
        verdict = { isBaggageManager: false, mfaPending: false, foreignClient: true }
        if (tokenHash && token) roleCache.write(tokenHash, 'role', verdict, jwtExpiresAtMs(token))
        return foreignClientBlock(req, path)
      }
      // テナントの停止を先に見る (停止すると admin_users も RLS で読めなくなり、下の「引けない
      // ときは素通し」に落ちてしまうため・20261029170000_tenant_suspension.sql)
      const { data: suspended } = await supa.rpc('auth_tenant_suspended')
      if (suspended === true) {
        verdict = { isBaggageManager: false, mfaPending: false, tenantSuspended: true }
        if (tokenHash && token) roleCache.write(tokenHash, 'role', verdict, jwtExpiresAtMs(token))
        return suspendedBlock(req, path)
      }
      // admin_users の表ではなく関数で読む。多要素が必須の人が未登録のあいだは、DB の層が表を
      // 読ませないので (20261031150000_mfa_required_admins.sql)、表を読むと「引けない」に落ちる
      const { data: role, error: roleError } = await supa.rpc('auth_user_role')
      const error = roleError || role == null
      // 参照できなかった（瞬断など）ときは従来どおり素通しし、**覚えない**。
      // ここで false を30秒持つと、直後に境界が効かなくなる窓を自分で作ってしまう。
      // ただし多要素の確認が済んでいない人は、ロールが分からなくても止める。
      if (error) return pending ? mfaBlock(req, path) : pwPending ? passwordChangeBlock(req, path) : res
      verdict = {
        isBaggageManager: role === 'baggage_manager',
        mfaPending: pending,
        mfaEnrollRequired: mfaEnrollmentRequired(role, user),
        passwordChangePending: pwPending,
      }
    }
    if (tokenHash && token) {
      roleCache.write(tokenHash, 'role', verdict, jwtExpiresAtMs(token))
    }
  }

  if (verdict === null) return res  // 未ログインは各ページの getUser がログインへ誘導。
  if (verdict.foreignClient) return foreignClientBlock(req, path)
  if (verdict.tenantSuspended) return suspendedBlock(req, path)
  if (verdict.mfaPending) return mfaBlock(req, path)
  if (verdict.passwordChangePending) return passwordChangeBlock(req, path)
  if (verdict.mfaEnrollRequired && !isMfaEnrollmentPath(path)) return mfaEnrollBlock(req, path)
  if (!verdict.isBaggageManager) return res  // 通常ロールは制限しない。

  // 手荷物検査店長が非許可パスに来た → API は 403、ページは /baggage へ。
  logSecurityEvent({ kind: 'auth.boundary', ip: requestIp(req.headers), path, detail: { role: 'baggage_manager' } })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'forbidden_baggage_manager' }, { status: 403 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/baggage'
  url.search = ''
  return NextResponse.redirect(url)
}

/**
 * 多要素の番号の確認が済んでいない人を止める。API は 401（画面の fetch がログインへ戻す）、
 * 画面は /login/mfa へ（確かめたら元の画面へ戻れるよう next を付ける。戻り先の可否は safeNext が決める）。
 */
/**
 * 拠点向けのトークンで来た要求を止める (lib/auth/foreign-client.ts)。API は 401、画面はログインへ。
 * Cookie は消さない (正規の手順で入り直せば上書きされる)。
 */
function foreignClientBlock(req: NextRequest, path: string): NextResponse {
  logSecurityEvent({ kind: 'auth.foreign_token', ip: requestIp(req.headers), path })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'foreign_client_token' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

/** 停止したテナントの利用者を止める。API は 403、画面は /suspended (理由とサインアウト)。 */
function suspendedBlock(req: NextRequest, path: string): NextResponse {
  logSecurityEvent({ kind: 'auth.tenant_suspended', ip: requestIp(req.headers), path })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'tenant_suspended' }, { status: 403 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/suspended'
  url.search = ''
  return NextResponse.redirect(url)
}

/**
 * 仮のパスワードのままの人を止める (ASVS 6.4.1)。API は 403、画面は /login/password
 * (本人のパスワードに変える画面。期限が過ぎていればその案内とサインアウト)。
 */
function passwordChangeBlock(req: NextRequest, path: string): NextResponse {
  logSecurityEvent({ kind: 'auth.password_change_required', ip: requestIp(req.headers), path })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'password_change_required' }, { status: 403 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login/password'
  url.search = ''
  return NextResponse.redirect(url)
}

function mfaBlock(req: NextRequest, path: string): NextResponse {
  logSecurityEvent({ kind: 'auth.mfa_required', ip: requestIp(req.headers), path })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'mfa_required' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login/mfa'
  url.search = ''
  url.searchParams.set('next', path + req.nextUrl.search)
  return NextResponse.redirect(url)
}

/** 多要素が必須の役割で未登録の人を止める。API は 403、画面は /account/security (登録の画面)。 */
function mfaEnrollBlock(req: NextRequest, path: string): NextResponse {
  logSecurityEvent({ kind: 'auth.mfa_enrollment_required', ip: requestIp(req.headers), path })
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'mfa_enrollment_required' }, { status: 403 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/account/security'
  url.search = ''
  url.searchParams.set('required', '1')
  url.searchParams.set('next', path + req.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = {
  // Next 内部アセットのみ除外。/api や画像URLは middleware 本体の isStaticAsset で判定し、
  // /api/*.png のような迂回を作らない。
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
