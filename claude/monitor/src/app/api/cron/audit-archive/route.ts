/**
 * 監査の記録を別の置き場 (R2・Bucket lock) へ書き出す cron (1 日 1 回・UTC 04:00・vercel.json)。
 * ASVS 5.0 L2 16.4.3。中身は src/lib/audit/archive.ts、置き場の作り方は docs/audit-archive.md。
 *
 * GET /api/cron/audit-archive                    前の日まで、直近 7 日で抜けている日を書き出す
 * GET /api/cron/audit-archive?backfill_days=120  初回などにさかのぼる (上限 400 日・同じ認証)
 *
 * 環境変数 AUDIT_ARCHIVE_BACKFILL_DAYS (秘密でない値) を入れると、日数の指定の無い呼び出し
 * (毎日の Cron・Vercel の画面の Run) もその日数だけさかのぼる (2026-11-07)。CRON_SECRET は
 * 機密の扱いで手元に取り出せないため、さかのぼりは「この変数を入れて再配備 → Run → 変数を消す」で行う。
 * 書き出し済みの日は飛ばすので、入れたままでも毎日の動きは変わらない (置き場を読む回数が増えるだけ)。
 *
 * 認証: Vercel Cron の形 (GET・Bearer) か `x-cron-secret`。定数時間で比べる。
 * 置き場が未設定なら 503 (証跡を外へ出せていないことを Cron の記録で見えるようにする)。
 * 失敗が 1 つでもあれば 500。書き出せなかった日は次の実行でやり直す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import { MAX_BACKFILL_DAYS, runAuditArchive } from '@/lib/audit/archive'
import { auditArchiveConfigured, r2ArchiveStore } from '@/lib/audit/archive-r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
/** Vercel の上限 (300 秒) の前に新しい日へ手を付けるのをやめる */
const BUDGET_MS = 240_000

function isCronRequest(req: NextRequest, secret: string): boolean {
  const same = (a: string | null, b: string) => {
    if (a === null) return false
    const x = Buffer.from(a), y = Buffer.from(b)
    return x.length === y.length && timingSafeEqual(x, y)
  }
  return same(req.headers.get('authorization'), `Bearer ${secret}`) || same(req.headers.get('x-cron-secret'), secret)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const started = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!isCronRequest(req, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
  }
  if (!auditArchiveConfigured()) {
    console.error('[audit-archive] 書き出し先 (AUDIT_ARCHIVE_*) が未設定です。監査の記録を外へ出せていません')
    return NextResponse.json({ error: 'audit_archive_not_configured' }, { status: 503 })
  }

  const raw = req.nextUrl.searchParams.get('backfill_days') ?? (process.env.AUDIT_ARCHIVE_BACKFILL_DAYS?.trim() || null)
  const n = raw === null ? undefined : Number.parseInt(raw, 10)
  if (n !== undefined && (!Number.isFinite(n) || n < 1 || n > MAX_BACKFILL_DAYS)) {
    return NextResponse.json({ error: `backfill_days は 1〜${MAX_BACKFILL_DAYS}` }, { status: 400 })
  }

  const summary = await runAuditArchive(createSupabaseService(), r2ArchiveStore(), {
    now: new Date(),
    days: n,
    deadline: started + BUDGET_MS,
  })
  if (summary.ok) console.log('[audit-archive]', JSON.stringify(summary))
  else console.error('[audit-archive] 書き出せなかった日があります (次の実行でやり直す)', JSON.stringify(summary))
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 })
}
