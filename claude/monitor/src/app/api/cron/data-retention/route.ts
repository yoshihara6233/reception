/**
 * データの保持期間で消す cron (1 日 1 回・UTC 03:30・vercel.json)。
 *
 * 発注者の決定 (2026-10-30・docs/data-classification.md §3・§4):
 *   従業員の顔: 登録を外したら即時 (消し残しを拾う)・1 年照合に使わなければ消す
 *   従業員の氏名: 登録を外してから 1 年
 *   BCP の生画像: 90 日 (PDF は残す)
 *   管理操作の記録: 5 年 / ライブの視聴の記録: 1 年 / 遠隔視聴の記録: 180 日
 * 中身は src/lib/retention/data-retention.ts。
 *
 * GET /api/cron/data-retention            Vercel Cron (`Authorization: Bearer $CRON_SECRET`)
 * GET /api/cron/data-retention?dry_run=1  数えるだけで何も消さない (同じ認証)
 *
 * 認証: Vercel Cron の形 (GET・Bearer) か `x-cron-secret`。定数時間で比べる。
 * Vercel Cron は GET で呼ぶ。POST だけを受けて一度も動いていなかった事故 (#432 の
 * /api/admin/vod/cleanup) を繰り返さないよう、GET を受けることを route.test.ts で確かめている。
 *
 * 失敗が 1 つでもあれば 500 を返す (Vercel の Cron の記録で失敗として見えるように)。
 * 消せなかった分は行を残してあるので、次の日の実行でやり直す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import { runDataRetention } from '@/lib/retention/data-retention'

export const dynamic = 'force-dynamic'
// 置き場と Rekognition を消すので時間がかかることがある
export const maxDuration = 300

/** Cron の呼び出しか (Vercel Cron の Bearer か、x-cron-secret)。定数時間で比べる。 */
function isCronRequest(req: NextRequest, secret: string): boolean {
  const same = (a: string | null, b: string) => {
    if (a === null) return false
    const x = Buffer.from(a), y = Buffer.from(b)
    return x.length === y.length && timingSafeEqual(x, y)
  }
  return same(req.headers.get('authorization'), `Bearer ${secret}`) || same(req.headers.get('x-cron-secret'), secret)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!isCronRequest(req, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const flag = req.nextUrl.searchParams.get('dry_run')
  const dryRun = flag === '1' || flag === 'true'
  const summary = await runDataRetention(createSupabaseService(), { now: new Date(), dryRun })
  if (summary.ok) console.log('[data-retention]', JSON.stringify(summary))
  else console.error('[data-retention] 消せなかったものがあります (次の実行でやり直す)', JSON.stringify(summary))
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 })
}
