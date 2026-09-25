/**
 * 遠隔視聴の後始末 cron（5 分ごと・GVMS_CLOUD_SPEC §5.2.2・§6）。
 *
 * ① 取り残し: 拠点が commands/next を取りに来ないと、止める判断（lib/video/dispatch.ts）が
 *    走らない。画面の生存が 2 分途切れた動いているセッションは、ここで stopped にする。
 *    拠点がすでに送っていても、合図（refresh_video）が止まるので 60 秒で拠点側も止まる。
 * ② 片付け: 終わって 2 分たったセッションの置き場（R2）を消す。仕様は「遅くとも 10 分後」。
 *    2 分待つのは、録画再生の終わり（ended）のあとも手元の再生が最後の区切りを
 *    読みに来るため。5 分ごとの実行なので最長でも 7 分で消える。
 *
 * 認証: 他の cron と同じ CRON_SECRET（Bearer / x-cron-secret）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { deleteVideoObjects, videoR2Configured } from '@/lib/storage/video-r2'
import { ACTIVE_STATES, TERMINAL_STATES, type VideoKind } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

const ABANDON_AFTER_MS = 2 * 60_000
const PURGE_AFTER_MS = 2 * 60_000
const PURGE_BATCH = 200

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const abandonBefore = new Date(now - ABANDON_AFTER_MS).toISOString()

  const { data: abandoned, error: abErr } = await svc
    .from('video_sessions')
    .update({ state: 'stopped', ended_at: nowIso })
    .in('state', ACTIVE_STATES as string[])
    .lt('viewer_seen_at', abandonBefore)
    .select('id')
  if (abErr) return NextResponse.json({ error: 'abandon_failed' }, { status: 500 })

  let purged = 0
  let purgeFailed = 0
  if (videoR2Configured()) {
    const { data: done, error: pErr } = await svc
      .from('video_sessions')
      .select('id, kind')
      .in('state', TERMINAL_STATES as string[])
      .in('kind', ['hls_live', 'hls_vod'])
      .is('purged_at', null)
      .lt('ended_at', new Date(now - PURGE_AFTER_MS).toISOString())
      .order('ended_at', { ascending: true })
      .limit(PURGE_BATCH)
    if (pErr) return NextResponse.json({ error: 'purge_list_failed' }, { status: 500 })

    for (const s of (done ?? []) as { id: string; kind: VideoKind }[]) {
      try {
        await deleteVideoObjects(s.id, s.kind)
        await svc.from('video_sessions').update({ purged_at: nowIso }).eq('id', s.id)
        purged++
      } catch {
        purgeFailed++ // 次の実行で取り直す
      }
    }
  }

  return NextResponse.json({ ok: true, abandoned: abandoned?.length ?? 0, purged, purge_failed: purgeFailed })
}
