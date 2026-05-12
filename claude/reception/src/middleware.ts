import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ── VULN-012 FIX: IP-based rate limiting for visitor-facing API endpoints ──────
//
// Uses an in-memory sliding-window counter (per Edge Function instance).
// This is a first line of defense. For production with high traffic,
// replace with an external store (e.g., Vercel KV / Upstash Redis).
//
// Limits:
//   - Visitor API (check-in, OCR, face-search): 20 req / 60s per IP
//   - Pre-registration lookup: 30 req / 60s per IP

type RateLimitEntry = { count: number; windowStart: number }
const rateLimitStore = new Map<string, RateLimitEntry>()

const RATE_LIMIT_RULES: Array<{ prefix: string; limit: number; windowMs: number }> = [
  { prefix: '/api/v1/visits/check-in',          limit: 20, windowMs: 60_000 },
  { prefix: '/api/v1/visits/check-out',          limit: 20, windowMs: 60_000 },
  { prefix: '/api/v1/ocr/',                      limit: 15, windowMs: 60_000 },
  { prefix: '/api/v1/visitors/face-search',      limit: 20, windowMs: 60_000 },
  { prefix: '/api/v1/visitors/face-register',    limit: 10, windowMs: 60_000 },
  { prefix: '/api/v1/pre-registrations',         limit: 30, windowMs: 60_000 },
  { prefix: '/api/v1/visits/photos',             limit: 30, windowMs: 60_000 },
]

function checkRateLimit(ip: string, path: string): { allowed: boolean; retryAfter?: number } {
  const rule = RATE_LIMIT_RULES.find(r => path.startsWith(r.prefix))
  if (!rule) return { allowed: true }

  const key = `${ip}:${rule.prefix}`
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || now - entry.windowStart > rule.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true }
  }

  if (entry.count >= rule.limit) {
    const retryAfter = Math.ceil((rule.windowMs - (now - entry.windowStart)) / 1000)
    return { allowed: false, retryAfter }
  }

  entry.count++
  return { allowed: true }
}

// Periodically clean up stale entries to prevent memory growth
let lastCleanup = Date.now()
function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < 300_000) return  // every 5 min
  lastCleanup = now
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > 120_000) rateLimitStore.delete(key)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Apply rate limiting to visitor-facing API routes
  if (pathname.startsWith('/api/v1/') && !pathname.startsWith('/api/v1/admin/')) {
    maybeCleanup()
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      '0.0.0.0'

    const { allowed, retryAfter } = checkRateLimit(ip, pathname)
    if (!allowed) {
      return NextResponse.json(
        { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter ?? 60),
            'X-RateLimit-Limit': '20',
          },
        }
      )
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protect /admin/* routes (except public auth pages)
  const adminPublicPaths = ['/admin/login', '/admin/forgot-password', '/admin/reset-password']
  if (pathname.startsWith('/admin') && !adminPublicPaths.some(p => pathname.startsWith(p))) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }
  }

  // Redirect logged-in users away from login page
  if (pathname === '/admin/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/v1/visits/check-in',
    '/api/v1/visits/check-out',
    '/api/v1/visits/photos',
    '/api/v1/ocr/:path*',
    '/api/v1/visitors/:path*',
    '/api/v1/pre-registrations',
    '/api/v1/pre-registrations/:path*',
  ],
}
