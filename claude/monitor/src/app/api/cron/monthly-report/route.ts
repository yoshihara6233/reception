/**
 * 月次レポート自動確定 cron（C / R6）— 毎日 JST 早朝（Vercel Cron・vercel.json）
 *
 * その日(JST)が各テナントの report_day（未設定=28）に一致するテナントについて、
 * 前月分を確定（スナップショット＋PDF）し、テナント管理者へリンクをメール通知する。
 * 認証: Vercel Cron の Bearer CRON_SECRET / x-cron-secret。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'
import { jstDateStr } from '@/lib/baggage/unmatch'
import { prevMonth } from '@/lib/reports/usage'
import { finalizeMonthlyReport } from '@/lib/reports/finalize'
import { appBaseUrl } from '@/lib/app-url'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_REPORT_DAY = 28

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const today = jstDateStr(new Date())
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7))
  const day = Number(today.slice(8, 10))
  const { year: py, month: pm } = prevMonth(curY, curM)
  const ym = `${py}-${String(pm).padStart(2, '0')}`
  const ymLabel = `${py}年${pm}月`

  // 手動テスト用に ?tenant= で単一テナントを即確定できる（report_day 判定を飛ばす）。
  const forceTenant = req.nextUrl.searchParams.get('tenant')

  const { data: tenants } = await svc.from('tenants').select('id, name, report_day').limit(1000)
  const targets = (tenants ?? []).filter((t) => {
    if (forceTenant) return t.id === forceTenant
    return (t.report_day ?? DEFAULT_REPORT_DAY) === day
  })

  const results: { tenant: string; ok: boolean; mailed?: number; error?: string }[] = []
  for (const t of targets) {
    try {
      const fin = await finalizeMonthlyReport(svc, t.id as string, ym, null)
      if (!fin.ok) { results.push({ tenant: t.id as string, ok: false, error: fin.error }); continue }

      const { data: admins } = await svc.from('admin_users')
        .select('email').eq('tenant_id', t.id).eq('role', 'tenant_admin').not('email', 'is', null)
      const to = ((admins ?? []) as { email: string | null }[]).map((a) => a.email).filter(Boolean) as string[]
      let mailed = 0
      if (to.length) {
        const appBase = appBaseUrl()
        const html = `<p>${t.name} 様</p><p>${ymLabel}の利用状況レポートを確定しました。</p>`
          + `<p><a href="${appBase}/admin/reports/usage?month=${ym}">管理画面で見る</a>`
          + (fin.pdfUrl ? ` / <a href="${fin.pdfUrl}">PDF</a>` : '') + '</p>'
        const r = await sendEmail(to, `【月次レポート】${t.name} ${ymLabel}`, html, undefined, SECURITY_FROM_ADDRESS)
        if (r.ok) mailed = to.length
      }
      results.push({ tenant: t.id as string, ok: true, mailed })
    } catch (e) {
      results.push({ tenant: t.id as string, ok: false, error: String((e as Error).message ?? e) })
    }
  }

  return NextResponse.json({ ok: true, ym, day, finalized: results.filter((r) => r.ok).length, results })
}
