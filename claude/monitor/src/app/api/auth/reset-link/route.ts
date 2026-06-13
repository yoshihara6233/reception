import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, passwordResetEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'

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
      hostname.endsWith('.intareco.jp') ||
      hostname.endsWith('.genesis-edge.com'))
  const origin = hostAllowed ? `${proto}://${host}` : 'https://intereco-monitor.vercel.app'

  try {
    const supabase = createSupabaseService()
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
