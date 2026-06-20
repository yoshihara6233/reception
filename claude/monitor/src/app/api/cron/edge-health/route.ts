/**
 * エッジ死活監視 cron（Phase A / G1: エッジ・トンネル死活監視 + アラート）。
 *
 * Vercel Cron が定期実行（vercel.json: 2分毎）。各エッジの last_seen_at が
 * EDGE_STALE_SECONDS（既定180秒=3分）より古ければ「無応答」と判定し、初回のみ
 * メール通知（alerted_at で重複抑止）。復旧（last_seen_at が新しくなった）時に
 * alerted_at を NULL に戻し、復旧通知を送る。
 *
 * heartbeat はエッジが約60秒毎に送る（edge-agent upload/storage.ts）。3分無応答 ＝
 * 概ね3回連続ミス。cron 2分毎 + 3分閾値で、障害発生から約5分以内に通知。
 *
 * 認証: Vercel Cron の `Authorization: Bearer <CRON_SECRET>`、または本プロジェクト
 * 慣例の `x-cron-secret: <CRON_SECRET>`。CRON_SECRET 未設定時は誰でも叩けてしまう
 * ので、本番では必ず設定する（未設定なら 503 で停止）。
 *
 * 通知先: ALERT_EMAILS（カンマ区切り）。未設定ならメールはスキップ（ログのみ）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, edgeOfflineAlertEmail, edgeRecoveredEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'

interface EdgeRow {
  id: string
  name: string | null
  last_seen_at: string | null
  alerted_at: string | null
  stores: { name: string | null } | null
}

function jst(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  } catch { return iso }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 認証 ──
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const staleSec   = Number(process.env.EDGE_STALE_SECONDS ?? 180)
  const staleMin   = Math.round(staleSec / 60)
  const thresholdMs = Date.now() - staleSec * 1000
  const recipients = (process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const monitorUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://intereco-monitor.vercel.app'

  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id, name, last_seen_at, alerted_at, stores ( name )')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const edges = (data ?? []) as unknown as EdgeRow[]
  let wentDown = 0, recovered = 0

  for (const e of edges) {
    // 一度も応答していないエッジ（last_seen_at NULL）は未設置扱い＝対象外。
    if (!e.last_seen_at) continue
    const isStale = new Date(e.last_seen_at).getTime() < thresholdMs

    if (isStale && !e.alerted_at) {
      // 新規ダウン → 通知 + alerted_at セット
      await supa.from('edge_devices').update({ alerted_at: new Date().toISOString() }).eq('id', e.id)
      wentDown++
      if (recipients.length) {
        const mail = edgeOfflineAlertEmail({
          edgeName: e.name ?? e.id.slice(0, 8),
          storeName: e.stores?.name ?? '(不明な店舗)',
          lastSeenAt: jst(e.last_seen_at),
          staleMin,
          monitorUrl,
        })
        await sendEmail(recipients, mail.subject, mail.html, undefined, SECURITY_FROM_ADDRESS)
      }
    } else if (!isStale && e.alerted_at) {
      // 復旧 → alerted_at クリア + 復旧通知
      await supa.from('edge_devices').update({ alerted_at: null }).eq('id', e.id)
      recovered++
      if (recipients.length) {
        const mail = edgeRecoveredEmail({
          edgeName: e.name ?? e.id.slice(0, 8),
          storeName: e.stores?.name ?? '(不明な店舗)',
          lastSeenAt: jst(e.last_seen_at),
          staleMin,
          monitorUrl,
        })
        await sendEmail(recipients, mail.subject, mail.html, undefined, SECURITY_FROM_ADDRESS)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: edges.length,
    wentDown,
    recovered,
    staleSec,
    recipients: recipients.length,
  })
}
