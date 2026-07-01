/**
 * 発報通知（Phase B / PB3）。
 *
 * new 発報を店舗の alarm_settings に従って通知する:
 *   - enabled でなければ通知しない（発報記録は残す）
 *   - quiet_hours（静音時間帯）内は通知を抑制
 *   - notify_emails へメール（Resend）／ notify_webhook_url へ JSON POST（任意）
 *   - 送ったら notified_at をセット（二重通知防止）
 * dedup（重複排除）は ingest 側で行い、ここは「通知の可否」だけを判断する。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'

/** now(UTC) が JST の [from,to) 静音窓に入るか。to='HH:MM'。日跨ぎ対応。 */
export function inQuietHours(now: Date, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const cur = (get('hour') % 24) * 60 + get('minute')
  const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
  const f = toMin(from), t = toMin(to)
  if (f == null || t == null || f === t) return false
  return f < t ? (cur >= f && cur < t) : (cur >= f || cur < t)
}

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const storeNameOf = (s: { name: string } | { name: string }[] | null | undefined) =>
  (Array.isArray(s) ? s[0]?.name : s?.name) ?? '—'

/** 1件の発報を通知する（best-effort）。返り値は通知したか＋理由。 */
export async function notifyAlarm(
  service: SupabaseClient,
  eventId: string,
): Promise<{ notified: boolean; reason?: string }> {
  const { data: ev } = await service
    .from('alarm_events')
    .select('id, store_id, source, event_type, occurred_at, notified_at, stores ( name )')
    .eq('id', eventId)
    .maybeSingle()
  if (!ev) return { notified: false, reason: 'not_found' }
  if (ev.notified_at) return { notified: false, reason: 'already' }

  const { data: st } = await service
    .from('alarm_settings')
    .select('enabled, quiet_from, quiet_to, notify_emails, notify_webhook_url')
    .eq('store_id', ev.store_id)
    .maybeSingle()
  if (!st?.enabled) return { notified: false, reason: 'disabled' }
  if (inQuietHours(new Date(), st.quiet_from, st.quiet_to)) return { notified: false, reason: 'quiet' }

  const storeName = storeNameOf((ev as { stores?: { name: string } | { name: string }[] | null }).stores)
  const kind = ev.event_type || ev.source
  const emails = (st.notify_emails ?? []).filter(Boolean)
  let didSomething = false

  if (emails.length) {
    const html = `<p>${storeName} で発報を検知しました。</p>`
      + `<p>種別: ${kind} ／ 時刻: ${fmtJst(ev.occurred_at)}</p>`
      + `<p>ダッシュボードで内容をご確認ください。</p>`
    const res = await sendEmail(emails, `【発報】${storeName} ${kind}`, html, undefined, SECURITY_FROM_ADDRESS)
    didSomething = didSomething || res.ok
  }
  if (st.notify_webhook_url) {
    try {
      await fetch(st.notify_webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store: storeName, source: ev.source, event_type: ev.event_type, occurred_at: ev.occurred_at, event_id: ev.id }),
      })
      didSomething = true
    } catch { /* best-effort */ }
  }

  await service.from('alarm_events').update({ notified_at: new Date().toISOString() }).eq('id', eventId)
  return { notified: didSomething }
}
