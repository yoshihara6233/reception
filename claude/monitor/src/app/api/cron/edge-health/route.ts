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
import {
  sendEmail, edgeOfflineAlertEmail, edgeRecoveredEmail,
  tunnelDownAlertEmail, tunnelRecoveredEmail, SECURITY_FROM_ADDRESS,
} from '@/lib/email/send'
import { sendOpsWebhook, opsWebhookConfigured } from '@/lib/ops/webhook'
import { nextTunnelState, probeStatusOk, TUNNEL_ALERT_AFTER_SEC } from '@/lib/ops/tunnel-health'
import { recordMetric } from '@/lib/metrics'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'
import { appBaseUrl } from '@/lib/app-url'

interface EdgeRow {
  id: string
  name: string | null
  store_id: string | null
  last_seen_at: string | null
  alerted_at: string | null
  go2rtc_host: string | null
  tunnel_down_since: string | null
  tunnel_alerted_at: string | null
  stores: { name: string | null } | null
}

// トンネルプローブ（数台×最大6秒）+ メール送信が2分cronの実行枠に収まるよう余裕を確保。
export const maxDuration = 60

/** 1本のトンネル（go2rtc origin）へ HEAD/GET プローブ。5xx・例外・タイムアウト=断。 */
async function probeTunnel(originSrc: string, timeoutMs = 6_000): Promise<boolean> {
  let origin: string
  try { origin = new URL(originSrc).origin } catch { return false }
  const headers: Record<string, string> = {}
  // Cloudflare Access 越え（live-proxy と同じサービストークン）。未設定でも
  // Access が 403 を返せば「トンネル自体は生きている」ので判定には支障なし。
  if (process.env.GO2RTC_CF_ACCESS_CLIENT_ID && process.env.GO2RTC_CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.GO2RTC_CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = process.env.GO2RTC_CF_ACCESS_CLIENT_SECRET
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(origin, { headers, cache: 'no-store', signal: ac.signal, redirect: 'manual' })
    return probeStatusOk(res.status)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
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

  // TC3: 中断判定の閾値は @intereco/shared の単一源に揃える（UI 派生と同値）。
  // 運用調整が要る場合のみ env EDGE_STALE_SECONDS で上書き。
  const staleSec   = Number(process.env.EDGE_STALE_SECONDS ?? MONITOR_STALE_SECONDS)
  const staleMin   = Math.round(staleSec / 60)
  const thresholdMs = Date.now() - staleSec * 1000
  const recipients = (process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const monitorUrl = appBaseUrl()

  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id, name, store_id, last_seen_at, alerted_at, go2rtc_host, tunnel_down_since, tunnel_alerted_at, stores ( name )')
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
      await recordMetric({ kind: 'edge_uptime', value: 0, edgeId: e.id, storeId: e.store_id })
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
      // 第2経路（是正5）: メール未設定/見落とし対策の運用 Webhook（設定時のみ）。
      await sendOpsWebhook(
        `🔴 エッジ無応答: ${e.stores?.name ?? '(不明な店舗)'} / ${e.name ?? e.id.slice(0, 8)}`
        + `（最終応答 ${jst(e.last_seen_at)}・${staleMin}分超）\n${monitorUrl}/admin/edges`,
      )
    } else if (!isStale && e.alerted_at) {
      // 復旧 → alerted_at クリア + 復旧通知
      await supa.from('edge_devices').update({ alerted_at: null }).eq('id', e.id)
      await recordMetric({ kind: 'edge_uptime', value: 1, edgeId: e.id, storeId: e.store_id })
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
      await sendOpsWebhook(
        `🟢 エッジ復旧: ${e.stores?.name ?? '(不明な店舗)'} / ${e.name ?? e.id.slice(0, 8)}（最終応答 ${jst(e.last_seen_at)}）`,
      )
    }
  }

  // ── トンネル死活（G1: heartbeat とは別経路の cloudflared/go2rtc 到達性） ──
  // 対象: go2rtc_host 設定済み かつ heartbeat 生存中のエッジのみ。
  // heartbeat 断のエッジは上でアラート済み＝トンネル断は自明なので二重通知しない
  // （tunnel 状態は据え置き。復旧後の次巡でプローブが再開して整合する）。
  let tunnelDown = 0, tunnelRecovered = 0
  const probeTargets = edges.filter((e) =>
    e.go2rtc_host && e.last_seen_at && new Date(e.last_seen_at).getTime() >= thresholdMs)
  const probeResults = await Promise.all(probeTargets.map((e) => probeTunnel(e.go2rtc_host!)))

  for (let i = 0; i < probeTargets.length; i++) {
    const e = probeTargets[i]
    const decision = nextTunnelState(
      probeResults[i],
      { downSince: e.tunnel_down_since, alertedAt: e.tunnel_alerted_at },
      Date.now(),
    )
    // 状態が変わった時だけ書き込む（2分毎の無駄書込みを避ける）。
    if (decision.downSince !== e.tunnel_down_since || decision.alertedAt !== e.tunnel_alerted_at) {
      await supa.from('edge_devices')
        .update({ tunnel_down_since: decision.downSince, tunnel_alerted_at: decision.alertedAt })
        .eq('id', e.id)
    }

    const edgeName = e.name ?? e.id.slice(0, 8)
    const storeName = e.stores?.name ?? '(不明な店舗)'
    const downMin = Math.max(1, Math.round(
      (Date.now() - new Date(e.tunnel_down_since ?? Date.now()).getTime()) / 60_000))

    if (decision.action === 'alert') {
      tunnelDown++
      await recordMetric({ kind: 'tunnel_uptime', value: 0, edgeId: e.id, storeId: e.store_id })
      if (recipients.length) {
        const mail = tunnelDownAlertEmail({ edgeName, storeName, downMin, monitorUrl })
        await sendEmail(recipients, mail.subject, mail.html, undefined, SECURITY_FROM_ADDRESS)
      }
      await sendOpsWebhook(
        `🔴 トンネル断: ${storeName} / ${edgeName}（エッジ本体は稼働・遠隔ライブ経路のみ断・${downMin}分継続）\n${monitorUrl}/admin/edges`,
      )
    } else if (decision.action === 'recover') {
      tunnelRecovered++
      await recordMetric({ kind: 'tunnel_uptime', value: 1, edgeId: e.id, storeId: e.store_id })
      if (recipients.length) {
        const mail = tunnelRecoveredEmail({ edgeName, storeName, downMin, monitorUrl })
        await sendEmail(recipients, mail.subject, mail.html, undefined, SECURITY_FROM_ADDRESS)
      }
      await sendOpsWebhook(`🟢 トンネル復旧: ${storeName} / ${edgeName}`)
    }
  }

  // metric_events 保持90日プルーン（毎時1回だけ実行＝2分cronでも無駄打ち回避）。
  let pruned = false
  if (new Date().getUTCMinutes() < 2) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    await supa.from('metric_events').delete().lt('ts', cutoff)
    pruned = true
  }

  return NextResponse.json({
    ok: true,
    checked: edges.length,
    pruned,
    wentDown,
    recovered,
    tunnelProbed: probeTargets.length,
    tunnelDown,
    tunnelRecovered,
    tunnelAlertAfterSec: TUNNEL_ALERT_AFTER_SEC,
    staleSec,
    recipients: recipients.length,
    webhook: opsWebhookConfigured(),
    // 通知経路ゼロでダウンを検知した場合の警告（ログ/監視で拾えるように明示）。
    unnotified: (wentDown > 0 || tunnelDown > 0) && recipients.length === 0 && !opsWebhookConfigured(),
  })
}
