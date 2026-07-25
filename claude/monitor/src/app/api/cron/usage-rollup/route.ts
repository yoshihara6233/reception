/**
 * 利用状況ロールアップ cron（R3）— 毎日 早朝 JST（Vercel Cron・vercel.json）
 *
 * refresh_usage_daily(from,to) を呼び、直近数日ぶんを usage_daily に upsert する
 * （遅延到着に備え既定で3日前まで再集計＝冪等）。
 *
 * 手動バックフィル: ?from=YYYY-MM-DD&to=YYYY-MM-DD を渡すとその範囲を再集計。
 * 認証: Vercel Cron の Bearer CRON_SECRET / x-cron-secret（他 cron と同形）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { jstDateStr } from '@/lib/baggage/unmatch'
import { rollupWindow } from '@/lib/reports/usage'

export const maxDuration = 300

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_DAYS_BACK = 3

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const today = jstDateStr(new Date())
  const qFrom = req.nextUrl.searchParams.get('from')
  const qTo   = req.nextUrl.searchParams.get('to')

  let from: string, to: string
  if (qFrom && qTo) {
    if (!DATE_RE.test(qFrom) || !DATE_RE.test(qTo) || qFrom > qTo) {
      return NextResponse.json({ error: 'invalid from/to (YYYY-MM-DD, from<=to)' }, { status: 400 })
    }
    from = qFrom; to = qTo
  } else {
    ({ from, to } = rollupWindow(today, DEFAULT_DAYS_BACK))
  }

  const svc = createSupabaseService()
  const { data, error } = await svc.rpc('refresh_usage_daily', { p_from: from, p_to: to })
  if (error) return NextResponse.json({ error: error.message, from, to }, { status: 500 })

  return NextResponse.json({ ok: true, from, to, upserted: data ?? 0 })
}
