import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, passwordResetEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'
import { rateLimitAllows, clientIp } from '@/lib/rate-limit'

/**
 * 回数制限。認証の入口なので閉じられない＝回数で縛るしかない。
 *   メール単位: 特定の受信箱への爆撃を止める。正規の人が押し直す分（3 回/時）は通す。
 *   IP 単位   : 宛先を変えながら大量に投げて Resend の枠を焼く経路を止める。
 */
const PER_EMAIL_LIMIT = 3
const PER_IP_LIMIT    = 10
const WINDOW_SECONDS  = 3600

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-link  { email }
 *
 * Generates a Supabase password-recovery link with the service role key and
 * EMAILS it to the user via Resend. The one-time token is delivered only by
 * email — never returned to the browser — so possessing the inbox proves
 * identity (unlike a flow that hands the token straight to the caller).
 *
 * Always responds 200 with a generic body regardless of whether the address
 * exists, to avoid account enumeration.
 *
 * Using admin.generateLink (rather than auth.resetPasswordForEmail) lets us
 * point the redirect at our own /reset-password page and sidesteps Supabase's
 * Site URL / redirect-allowlist configuration entirely (see intereco-patterns).
 */
export async function POST(req: NextRequest) {
  const generic = NextResponse.json({ ok: true })

  let email: string
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim() : ''
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 })
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'メールアドレスを確認してください' }, { status: 400 })
  }

  // Build the origin from forwarded headers so the link points back at this
  // exact deployment. Validate the host to keep the recovery token on our own
  // domain (no open redirect / token exfiltration).
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const hostname = host.split(':')[0]
  const hostAllowed =
    host !== '' &&
    (hostname.endsWith('.vercel.app') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.genesis-edge.com'))
  const origin = hostAllowed ? `${proto}://${host}` : 'https://intereco-monitor.vercel.app'

  try {
    const supabase = createSupabaseService()

    // 上限超過でも本文は generic（存在有無も、弾いたことも教えない）。
    // 429 を返すと「この宛先は実在する」の手掛かりになりうるため 200 のまま黙って落とす。
    const ip = clientIp(req)
    const okEmail = await rateLimitAllows(
      supabase, `reset-link:email:${email.toLowerCase()}`, PER_EMAIL_LIMIT, WINDOW_SECONDS)
    const okIp = ip
      ? await rateLimitAllows(supabase, `reset-link:ip:${ip}`, PER_IP_LIMIT, WINDOW_SECONDS)
      : true
    if (!okEmail || !okIp) {
      console.warn('[reset-link] rate limited:', okEmail ? 'ip' : 'email')
      return generic
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${origin}/reset-password` },
    })

    const otp = data?.properties?.email_otp
    if (error || !otp) {
      // Unknown address (or generation failed): stay silent to avoid enumeration.
      console.warn('[reset-link] generateLink skipped:', error?.message ?? 'no otp')
      return generic
    }

    const resetUrl = `${origin}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(otp)}`
    const { subject, html } = passwordResetEmail(resetUrl)
    await sendEmail(email, subject, html, undefined, SECURITY_FROM_ADDRESS)
  } catch (err) {
    console.error('[reset-link] error:', err)
    // Still return generic success — never leak whether the address exists.
  }

  return generic
}
